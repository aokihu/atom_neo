# Skill System

> **Purpose**: 可插拔 AI Agent 技能模块 — 支持按需加载、分段注入、自主卸载的上下文感知技能系统。

---

## 1. 设计动机

Agent 在执行复杂任务时需要领域特定的操作指引（如 "SSH 远程服务器部署"、"数据库迁移脚本"）。如果一次性加载所有技能文档，context 会快速膨胀。Skill System 通过 **三层加载模型** 解决此问题：

| 层级 | 内容 | 时机 | context 成本 |
|------|------|------|-------------|
| L1 — 技能索引 | `name + description + capabilities` | 始终注入 system prompt | ~100B/skill |
| L2 — 首次加载 | 完整 `SKILL.md` + 自动生成的 section 偏移表 | Agent 调用 `skill_load` 时 | 一次性 |
| L3 — 按需分段注入 | 单个 `## Section` 内容片段 | Agent 调用 `skill_section` 时 | 仅当前需要的 section |
| 卸载 | 移除 section 或整个 skill | Agent 调用 `skill_remove_section` / `skill_unload` | context 回收 |

---

## 2. 文件布局

```
SANDBOX/.atom/skills/                    # 技能存放目录（手动编写，不进 Git）
├── remote-server-setup/                 # 一个技能一个目录
│   ├── SKILL.md                         # 技能定义（YAML frontmatter + ## sections）
│   └── references/                      # 可选：补充参考文档
│       └── ssh-cheatsheet.md
├── database-migration/
│   └── SKILL.md
└── web-deploy/
    └── SKILL.md
```

**规则**：
- 技能统一存放在 `{SANDBOX}/.atom/skills/` 下
- 每个技能一个子目录，目录名即为 `name`
- 目录下必须有 `SKILL.md`，可选 `references/`

---

## 3. SKILL.md 格式

```markdown
---
name: remote-server-setup
description: 远程服务器安装与调试 — SSH登录、防火墙配置、Nginx部署、Docker安装
capabilities:
  - ssh-login
  - firewall-setup
  - nginx-config
  - docker-install
version: "1.0"
---

## ssh-login

使用以下命令通过 SSH 登录远程服务器：

ssh user@host -p 22

登录成功后确认系统信息：
uname -a
cat /etc/os-release

## firewall-setup

配置 ufw 防火墙：

ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

## nginx-config

安装 Nginx：
apt update && apt install -y nginx

配置站点：
vim /etc/nginx/sites-available/default

重启服务：
systemctl restart nginx

## docker-install

安装 Docker：
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER
```

### YAML Frontmatter 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 唯一标识，与目录名一致 (kebab-case) |
| `description` | `string` | 是 | 用途 + 触发关键词，用于 `skill_list` 匹配 |
| `capabilities` | `string[]` | 是 | 可用 section 列表，用于 Agent 做轻量索引 |
| `version` | `string` | 否 | 版本号 |

### Section 自动检测

系统扫描 `SKILL.md` 中所有 `## ` 顶级标题，**自动生成** section 偏移表：

```typescript
// 示例：解析 remote-server-setup/SKILL.md 后的偏移表
{
  "ssh-login":       { offset: 14, length: 7 },
  "firewall-setup":  { offset: 21, length: 7 },
  "nginx-config":    { offset: 28, length: 7 },
  "docker-install":  { offset: 35, length: 6 },
}
```

前端 yaml 区域的 `capabilities` 字段用于 `skill_list` 返回轻量索引，后端按 `## ` 标题偏移精准提取内容，不依赖 Agent 手动计算行号。

---

## 4. Context 注入格式

采用 **Nested XML** 结构，`<skill>` 包裹 `<section>`，支持同一 skill 的多 section 合并以及级联卸载：

### 单个 section

```xml
<skill name="remote-server-setup">
  <section name="ssh-login">

使用以下命令通过 SSH 登录远程服务器：

ssh user@host -p 22

  </section>
</skill>
```

### 多个 section 合并

```xml
<skill name="remote-server-setup">
  <section name="ssh-login">

ssh user@host -p 22

  </section>
  <section name="firewall-setup">

ufw allow 80/tcp

  </section>
</skill>
```

### 注入位置

在 system prompt 中，skill context 插入在 `compiledAgentsPrompt` 之后、`contextData` 之前：

```
[systemPrompt]
[vv compiledAgentsPrompt]
<skill name="A">...</skill>
<skill name="B">...</skill>
[contextData]
[vv userMessages...]
```

---

## 5. Agent 可用 Tools

5 个 tool 均注册为标准 `ToolDefinition`，LLM 可自主调用：

| Tool | 输入 | 输出 | 副作用 |
|------|------|------|--------|
| `skill_list` | 无 | `[{name, description, capabilities}]` JSON | 无 |
| `skill_load` | `{name: string}` | `Loaded skill "{name}" with sections: [...]` | 注入 SKILL.md 全文到 context |
| `skill_section` | `{name: string, section: string}` | `Loaded section "{section}" from skill "{name}"` | 注入指定 section 到 context |
| `skill_remove_section` | `{name: string, section: string}` | `Removed section "{section}" from skill "{name}"` | 从 context 移除指定 section |
| `skill_unload` | `{name: string}` | `Unloaded skill "{name}"` | 移除该 skill 的全部 section |

### Tool 定义示例

```typescript
import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import type { SkillServiceLike } from "../skills/types";

export function createSkillLoadTool(svc: SkillServiceLike): ToolDefinition {
  return {
    name: "skill_load",
    description: "加载指定 Skill 的完整内容到上下文，返回所有可用 sections。首次使用时调用。",
    source: "builtin",
    inputSchema: z.object({ name: z.string().describe("Skill 名称") }),
    execute: async (args) => {
      const { name } = args as { name: string };
      const result = svc.load(name);
      if (!result.ok) return { ok: false, output: result.error! };
      return { ok: true, output: `Loaded skill "${name}" with sections: ${result.sections?.join(", ")}` };
    },
  };
}
```

---

## 6. SkillService 服务架构

`SkillService` 继承 `BaseService`，通过 `ServiceManager` 注册管理，与 Core 解耦。

### 6.1 与 Core 的隔离

Core 通过 **鸭子类型接口** 访问 SkillService，不直接引用具体类：

```typescript
// Core 侧定义（不 import SkillService 类）
interface SkillServiceLike {
  list(): SkillListItem[];
  load(name: string): SkillLoadResult;
  loadSection(name: string, section: string): boolean;
  removeSection(name: string, section: string): boolean;
  unload(name: string): void;
  buildContext(): string;
}
```

### 6.2 生命周期

```
ServiceManager.register("skill", new SkillService({ sandbox }))
  ↓
SkillService.start()
  ├── 扫描 SANDBOX/.atom/skills/
  ├── 解析每个 SKILL.md 的 YAML + ## sections
  ├── 缓存到内存
  └── 返回（同步阻塞，毫秒级）
  ↓
Core.sm.get("skill") → SkillServiceLike
  ↓
Agent 调用 tool → SkillService.load() / loadSection() ... → 更新运行时状态
  ↓
Pipeline → SkillService.buildContext() → 注入到 system prompt
  ↓
SkillService.stop()
  └── 清理缓存
```

### 6.3 核心方法

```
SkillService extends BaseService
├── start()
│     → 扫描 .atom/skills/*/SKILL.md
│     → 解析 YAML frontmatter + 检测 ## sections
│     → 缓存 {name → { meta, sections: Map<section, {offset, length}> }}
│     → 内部持有 Parser 实例（当前为 MechanicalParser）
│
├── list(): SkillListItem[]
│     → 返回 [{name, description, capabilities}]
│
├── load(name): SkillLoadResult
│     → 验证 skill 存在
│     → activeSections.set(name, new Set(all section names))
│
├── loadSection(name, section): boolean
│     → activeSections.get(name)?.add(section)
│
├── removeSection(name, section): boolean
│     → activeSections.get(name)?.delete(section)
│     → 如果 activeSections[name] 为空，级联移除整个 skill
│
├── unload(name): void
│     → activeSections.delete(name)
│
├── buildContext(): string
│     → 遍历 activeSections
│     → 对每个 {skill, sections}，按行偏移读取 SKILL.md 内容
│     → 组装 nested XML 字符串返回
│
└── stop()
      → 清理 activeSections + 文件缓存
```

### 6.4 数据结构

```typescript
type SkillSectionMeta = {
  offset: number;   // 行号（1-based）
  length: number;   // 行数
};

type SkillDef = {
  name: string;
  description: string;
  capabilities: string[];
  version?: string;
  filePath: string;
  sections: Map<string, SkillSectionMeta>;
};

type SkillListItem = {
  name: string;
  description: string;
  capabilities: string[];
};

type SkillLoadResult = {
  ok: boolean;
  sections?: string[];
  error?: string;
};
```

### 6.5 为 LLM 解析预留扩展点

当前使用 **MechanicalParser**（YAML + `##` 检测），未来可切换为 LLM 解析，Core 完全无感知：

```typescript
// 内部 parser 抽象
interface SkillParser {
  parse(filePath: string): Promise<SkillDef>;
}

// 当前实现
class MechanicalParser implements SkillParser {
  parse(filePath: string): SkillDef { /* YAML + ## 切分 */ }
}

// 未来实现（无需改动 Core）
class LLMParser implements SkillParser {
  parse(filePath: string): Promise<SkillDef> { /* LLM 精细切分 + 内容压缩 */ }
}

// SkillService 持有 parser，start() 中调用
class SkillService extends BaseService {
  #parser: SkillParser;

  constructor(params: { sandbox: string; parser?: SkillParser }) {
    this.#parser = params.parser ?? new MechanicalParser();
  }
}
```

---

## 7. 与 Conversation Pipeline 集成

### 新增 Pipeline Element: `InjectSkillContext`

```typescript
export class InjectSkillContextElement
  extends BaseElement<ConversationFlowState, ConversationFlowState> {

  #skillService: SkillServiceLike;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    skillService: SkillServiceLike;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#skillService = params.skillService;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;
    const skillContext = this.#skillService.buildContext();
    return { ...input, skillContext };
  }
}
```

### FlowState 新增字段

```typescript
// ConversationFlowState 追加
export type ConversationFlowState = {
  // ... existing fields
  skillContext?: string;   // SkillManager.buildContext() 的输出
};
```

### Pipeline 链路（插入位置）

```
collect-prompts
  → load-system-prompt       # systemPrompt
  → fetch-agents-prompt      # compiledAgentsPrompt
  → inject-skill-context     # NEW ← skillContext (从 SkillService 读取)
  → collect-context          # contextData
  → format-system-messages   # 拼接: systemPrompt + compiledAgentsPrompt + skillContext + contextData
  → format-user-messages
  → stream-llm
  → ...
```

### `format-system-messages` 修改

```typescript
// 原有:
// parts.push(systemPrompt, compiledAgentsPrompt, contextData)

// 修改为:
parts.push(systemPrompt);
if (input.compiledAgentsPrompt) parts.push(input.compiledAgentsPrompt);
if (input.skillContext) parts.push(input.skillContext);
if (input.contextData) parts.push(input.contextData);
```

---

## 8. 启动与初始化

`SkillService` 遵循项目统一的 Service 模式，通过 `ServiceManager` 注册和启动。

### 在 `main.ts` 中注册

```typescript
// main.ts
import { SkillService } from "./services/skill-service";

const sm = new ServiceManager({ logger });
sm.register("memory", new MemoryService({ ... }));
sm.register("agents-compiler", new AgentsCompilerService({ runtime }));
sm.register("skill", new SkillService({ sandbox: runtime.sandbox }));  // NEW

await sm.startAll();  // 遍历所有 service → 逐一调用 start()
```

### 在 `startCore()` 中注入

```typescript
// core/src/server.ts
import type { SkillServiceLike } from "./skills/types";

const skillService = sm.get<SkillServiceLike>("skill");
const skillTools = createSkillTools(skillService);

// 注入 pipeline deps
conversationPipeline({
  ...,
  skillService,     // ← 传入 pipeline
  tools: [...tools, ...skillTools],  // 5 个 tool 注册
});
```

### `ConversationPipelineDeps` 新增字段

```typescript
// core/src/pipelines/conversation/index.ts
export type ConversationPipelineDeps = {
  // ... existing fields
  skillService?: SkillServiceLike;
};
```

### 容错：service 未注册

`sm.get("skill")` 返回 `undefined` 时，5 个 tool 不注册，`buildContext()` 返回空字符串。整个 Core 不受影响。

### 懒扫描

- `start()` 时扫描一次 `{.atom/skills/}`，缓存所有 SKILL.md 的解析结果
- 运行时不监听文件变更（技能由用户手动编写，变更后重启生效）
- 如果 `.atom/skills/` 目录不存在或为空，`SkillService.start()` 正常运行，`list()` 返回空数组

---

## 9. 容错设计

| 场景 | 行为 |
|------|------|
| `.atom/skills/` 目录不存在 | `skill_list` 返回 `[]`，`skill_load` 返回 error |
| SKILL.md 没有 `## ` section | `skill_load` 将全文视为一个 section，命名为 `default` |
| YAML frontmatter 缺失 `capabilities` | 从 section 标题自动生成 `capabilities` 列表 |
| `skill_section` 请求不存在的 section | 返回 error: `Section "xxx" not found in skill "yyy"` |
| `skill_load` 已加载的 skill 重复调用 | 幂等：返回已加载状态，不重复注入 |
| LLM 调用 `skill_section` 未先 `skill_load` | 容错：自动执行 `skill_load`（内部懒加载） |

---

## 10. 完整调用链示例

```
用户: "帮我在新服务器上配置 Nginx"

1. LLM 读到 system prompt 中的 <available_skills>:
   - remote-server-setup: SSH登录、防火墙配置、Nginx部署、Docker安装
     capabilities: [ssh-login, firewall-setup, nginx-config, docker-install]

2. LLM 调用 skill_list() → 确认 remote-server-setup 存在

3. LLM 调用 skill_load("remote-server-setup")
   → SkillService 注入完整 SKILL.md + 返回 sections 列表

4. LLM 分析当前进度（无 SSH 信息）
   → 调用 skill_section("remote-server-setup", "ssh-login")

   Context 注入:
   <skill name="remote-server-setup">
     <section name="ssh-login">
   ssh user@host -p 22
     </section>
   </skill>

5. 与用户交互 → SSH 登录成功

6. LLM 调用 skill_remove_section("remote-server-setup", "ssh-login")
   → ssh-login section 从 context 移除

7. LLM 调用 skill_section("remote-server-setup", "nginx-config")
   → nginx-config section 注入

8. 按 nginx 步骤操作 → 完成

9. LLM 调用 skill_unload("remote-server-setup")
   → 整个 <skill> 块从 context 移除，级联清理所有剩余 section
```

步骤 4 时 LLM context 中只有 `ssh-login` 部分的 5 行内容，而非整个 `SKILL.md`（可能数百行）。

---

## 11. 待建文件清单

| 文件 | 包 | 说明 |
|------|-----|------|
| `shared/src/types/skill.ts` | `@atom-neo/shared` | SkillDef, SkillListItem, SkillSectionMeta, SkillLoadResult, SkillServiceLike 类型 |
| `services/skill-service.ts` | app-level | SkillService — extends BaseService, 生命周期管理，持 parser |
| `services/skill-parser.ts` | app-level | MechanicalParser + SkillParser 接口（为 LLM 解析预留） |
| `core/src/skills/types.ts` | `@atom-neo/core` | SkillServiceLike 接口定义 |
| `core/src/tools/builtin/skill.ts` | `@atom-neo/core` | 5 个 tool 定义函数 (createSkillTools) |
| `core/src/pipelines/conversation/elements/inject-skill-context.ts` | `@atom-neo/core` | 新 Pipeline Element |
| `src/main.ts` (修改) | app-level | sm.register("skill", new SkillService({ sandbox })) |
| `core/src/server.ts` (修改) | `@atom-neo/core` | 通过 sm.get("skill") 获取 service，注册 tools，传入 pipeline |
| `core/src/pipelines/conversation/elements/types.ts` (修改) | `@atom-neo/core` | FlowState 追加 skillContext 字段 |
| `core/src/pipelines/conversation/elements/format-system-messages.ts` (修改) | `@atom-neo/core` | 拼接 skillContext |
| `core/src/pipelines/conversation/index.ts` (修改) | `@atom-neo/core` | 注册 inject-skill-context element，追加 skillService deps |
| `shared/src/prompts/system.md` (修改) | `@atom-neo/shared` | 添加 `<available_skills>` + tool 使用说明 |
| `shared/src/types/index.ts` (修改) | `@atom-neo/shared` | 导出 skill 类型 |
