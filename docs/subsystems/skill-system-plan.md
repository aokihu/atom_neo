# Skill System — 开发计划

> **原则**：测试先行，每阶段先写测试（红），再实现（绿）。完成全部阶段后统一验证 typecheck。

---

## Phase 1: 类型定义

### 新建文件
`src/packages/shared/src/types/skill.ts`

```typescript
export type SkillSectionMeta = { offset: number; length: number };

export type SkillDef = {
  name: string; description: string; capabilities: string[];
  version?: string; filePath: string;
  sections: Map<string, SkillSectionMeta>;
};

export type SkillListItem = { name: string; description: string; capabilities: string[] };

export type SkillLoadResult = { ok: boolean; sections?: string[]; error?: string };
```

### 修改文件
`src/packages/shared/src/types/index.ts` — 新增 `export * from "./skill";`

### 测试
无（纯类型定义，无运行时逻辑）

---

## Phase 2: SkillParser — 机械解析器

### 新建文件

| 文件 | 说明 |
|------|------|
| `src/services/skill-parser.ts` | `SkillParser` 接口 + `MechanicalParser` 实现 |
| `src/services/skill-parser.test.ts` | 测试 |

### 测试用例（先写）

| # | 测试名 | 输入 | 预期 |
|---|--------|------|------|
| 1 | parses valid SKILL.md with YAML + sections | 标准 4-section SKILL.md 内容 | SkillDef 含 4 个 section，capabilities 来自 YAML |
| 2 | returns single "default" section when no ## headers | 有 YAML 但无 `## ` 标题的 Markdown | capabilities = ["default"]，sections: { default: { offset, length } } 覆盖全文 |
| 3 | generates capabilities from sections when YAML missing capabilities | 无 `capabilities` 字段的 SKILL.md | capabilities 从 `## ` 标题自动生成 |
| 4 | parses version from YAML frontmatter | version: "2.0" | SkillDef.version = "2.0" |
| 5 | handles empty SKILL.md gracefully | 空字符串 | capabilities = []，sections = empty Map |

### 接口

```typescript
interface SkillParser {
  parse(content: string, filePath: string): SkillDef;
}

class MechanicalParser implements SkillParser {
  parse(content: string, filePath: string): SkillDef;
}
```

### 验证
`bun test` — 5 个用例全通过

---

## Phase 3: SkillService — 运行时服务

### 新建文件

| 文件 | 说明 |
|------|------|
| `src/services/skill-service.ts` | `SkillService extends BaseService` |
| `src/services/skill-service.test.ts` | 测试 |

### 测试用例（先写）

**准备工作**：`beforeEach` 在 `mkdtempSync` 目录中创建 `.atom/skills/` 目录和 SKILL.md 样本文件

| # | 测试名 | 预期 |
|---|--------|------|
| 1 | `start()` scans skill directory and populates cache | `list()` 返回所有 skill |
| 2 | `start()` handles missing skill directory | `start()` 不抛异常，`list()` 返回 `[]` |
| 3 | `list()` returns all skills | 返回 `[{name, description, capabilities}]` |
| 4 | `load()` activates all sections and returns section names | `load("test-skill")` 返回所有 section 名 |
| 5 | `load()` fails on unknown skill name | `ok: false, error: "Skill ... not found"` |
| 6 | `load()` is idempotent | 重复调用返回同样结果，不抛异常 |
| 7 | `loadSection()` activates a single section | `loadSection("test-skill", "firewall")` 成功，`buildContext()` 只包含该 section |
| 8 | `loadSection()` auto-calls `load()` when skill is not yet loaded | 未 `load()` 先调 `loadSection()`，自动懒加载 |
| 9 | `loadSection()` fails on unknown section | 返回 `false` |
| 10 | `removeSection()` removes section from context | `buildContext()` 不包含被移除的 section |
| 11 | `removeSection()` cascades skill unload when last section removed | 所有 section 都移除后，skill 从 activeSections 中清除 |
| 12 | `unload()` removes entire skill | 所有 section 一并移除，`buildContext()` 空 |
| 13 | `buildContext()` returns empty string when no sections are active | 初始状态返回 `""` |
| 14 | `buildContext()` generates correct nested XML | 两个 section 激活，输出格式校验（含 `<skill>`, `<section>` 标签） |
| 15 | `stop()` clears all state | 调用 `stop()` 后 `list()` 返回 `[]`，`buildContext()` 返回 `""` |

### 实现要点

- 继承 `BaseService`，`readonly name = "skill"`
- `start()` 扫描 `${sandbox}/.atom/skills/` → 用 `MechanicalParser` 解析
- 内部维护 `#skillDefs: Map<string, SkillDef>`（文件缓存）+ `#activeSections: Map<string, Set<string>>`（运行时状态）
- `buildContext()` 遍历 `#activeSections`，按偏移读取文件内容，组装 XML

### 验证
`bun test` — 15 个用例全通过

---

## Phase 4: Core 接口定义

### 新建文件
`src/packages/core/src/skills/types.ts`

```typescript
import type { SkillListItem, SkillLoadResult } from "@atom-neo/shared";

export type SkillServiceLike = {
  list(): SkillListItem[];
  load(name: string): SkillLoadResult;
  loadSection(name: string, section: string): boolean;
  removeSection(name: string, section: string): boolean;
  unload(name: string): void;
  buildContext(): string;
};
```

### 测试
无（纯类型定义）

---

## Phase 5: Skill Tools — 5 个 ToolDefinition

### 新建文件

| 文件 | 说明 |
|------|------|
| `src/packages/core/src/tools/builtin/skill.ts` | `createSkillTools(svc)` → 返回 5 个 ToolDefinition |
| `src/packages/core/src/tools/builtin/skill.test.ts` | 测试 |

### 测试用例（先写）

**准备工作**：mock `SkillServiceLike` 对象，mock 各方法行为

| # | 测试名 | 预期 |
|---|--------|------|
| 1 | `skill_list` returns all skills | `execute({})` → `ok: true, output: JSON.stringify([...])` |
| 2 | `skill_load` loads skill successfully | `execute({name: "test"})` → `ok: true`，`output` 含 sections 列表 |
| 3 | `skill_load` returns error for unknown skill | `execute({name: "unknown"})` → `ok: false` |
| 4 | `skill_section` loads section successfully | `execute({name: "test", section: "ssh"})` → `ok: true` |
| 5 | `skill_section` returns error for unknown section | `execute({name: "test", section: "bad"})` → `ok: false` |
| 6 | `skill_remove_section` removes section | `execute({name: "test", section: "ssh"})` → `ok: true` |
| 7 | `skill_remove_section` returns error for unknown section | `execute({name: "test", section: "bad"})` → `ok: false` |
| 8 | `skill_unload` unloads skill | `execute({name: "test"})` → `ok: true` |
| 9 | `skill_unload` succeeds even if skill was not loaded | `execute({name: "test"})` → `ok: true`（幂等） |
| 10 | all tools have required fields | 每个 tool 都有 `name`, `description`, `source`, `inputSchema`, `execute` |

### 验证
`bun test` — 10 个用例全通过

---

## Phase 6: InjectSkillContext Pipeline Element

### 新建文件

| 文件 | 说明 |
|------|------|
| `src/packages/core/src/pipelines/conversation/elements/inject-skill-context.ts` | Pipeline Element |
| `src/packages/core/src/pipelines/conversation/elements/inject-skill-context.test.ts` | 测试 |

### 测试用例（先写）

**准备工作**：mock `SkillServiceLike`，mock `PipelineEventBus` 和 `ConversationFlowState`

| # | 测试名 | 预期 |
|---|--------|------|
| 1 | injects skillContext when mode is "streaming" | `doProcess({mode: "streaming", ...})` → 返回含 `skillContext` 字段 |
| 2 | passes through when mode is not "streaming" | `doProcess({mode: "initial", ...})` → 返回原 state，不修改 |
| 3 | skillContext is empty string when no sections active | mock `buildContext()` 返回 `""` → state.skillContext = `""` |

### 验证
`bun test` — 3 个用例全通过

---

## Phase 7: 集成 Wiring

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/services/service-manager.ts` | 无需改（通用 get<T>） |
| `src/main.ts` | 注册 `sm.register("skill", new SkillService({ sandbox }))` |
| `src/packages/core/src/server.ts` | `sm.get("skill")` → 注册 tools → 传入 pipeline |
| `src/packages/core/src/pipelines/conversation/elements/types.ts` | `ConversationFlowState` 追加 `skillContext?: string` |
| `src/packages/core/src/pipelines/conversation/elements/format-system-messages.ts` | 拼接 `skillContext` 到 parts |
| `src/packages/core/src/pipelines/conversation/elements/index.ts` | 导出 `InjectSkillContextElement` |
| `src/packages/core/src/pipelines/conversation/index.ts` | 注册 element 名称，pipeline 链路插入 `.transform("inject-skill-context", {skillService})` |
| `src/packages/shared/src/prompts/system.md` | 添加 `<available_skills>` + tool 使用说明 |

### 测试
- 运行 `bun test` 确保已有测试不受影响
- 运行 `bun run typecheck` 确保全量类型正确

---

## Phase 8: 端到端验证

### 手动验证步骤

1. 在 `sandbox/.atom/skills/test-skill/SKILL.md` 创建样本 skill
2. 启动 atom，在 TUI 中对话
3. 验证 Agent 能调用 `skill_list` → 看到 test-skill
4. 验证 Agent 能调用 `skill_load` → 获取 sections 列表
5. 验证 Agent 能调用 `skill_section` → context 中注入对应内容
6. 验证 Agent 能调用 `skill_remove_section` / `skill_unload` → context 回收

### 自动化 E2E

可选：在 `tests/e2e/` 中添加 `skill.test.ts`，启动 Core 服务后通过 HTTP/WS 发送 task，验证 tool 调用链路。

---

## 执行顺序总结

```
Phase 1 ─── types 定义（无测试）
    ↓
Phase 2 ─── SkillParser + 5 测试
    ↓
Phase 3 ─── SkillService + 15 测试
    ↓
Phase 4 ─── Core 接口定义（无测试）
    ↓
Phase 5 ─── Skill Tools + 10 测试
    ↓
Phase 6 ─── Pipeline Element + 3 测试
    ↓
Phase 7 ─── 集成 Wiring（修改现有文件，验证已有测试 + typecheck）
    ↓
Phase 8 ─── 端到端验证
```

**每阶段独立提交**，commit message 格式：`v1.6.2-phase{N}: {description}`。
