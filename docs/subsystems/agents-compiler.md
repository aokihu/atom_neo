# Agents Compiler

> **Purpose**: 安全导向的 AGENTS.md 编译器 — 通过 LLM 对用户指令进行无害化过滤，缓存编译结果。

## 1. 职责

`AgentsCompilerService` 监视沙箱中的 `AGENTS.md` 文件，当其内容变更时自动触发 LLM 编译：移除恶意/越狱内容，保留合法开发指引，将安全的编译结果注入到 conversation pipeline 的 system prompt 中。

## 2. 集成链路

```
AGENTS.md (用户文件)
    │
    ▼ (fs.watch + SHA-256 哈希)
AgentsCompilerService (通过 DeepSeek LLM 无害化过滤)
    │
    ▼ getCompiledPrompt(): string
Core Server (server.ts)
    │  包装为闭包
    ▼ getCompiledPrompt callback
Conversation Pipeline
    │  step 3: "fetch-agents-prompt"
    ▼ FetchAgentsPromptElement.doProcess()
    │  compiledAgentsPrompt → FlowState
    ▼
format-system-messages → stream-llm
    (注入到 LLM system prompt)
```

## 3. 核心特性

### 增量编译 + 缓存

```
AGENTS.md 变更 → 计算 SHA-256
  ├─ 命中缓存 → 复用 sandbox/.atom/compiled_prompts/{hash}.md
  └─ 未命中 → 调用 LLM 编译 → 写入缓存 + 更新 .atom/agents_meta.json
```

**历史保留**: 最多保留最近 5 个编译结果，旧的自动清理。

### 无害化过滤

编译 LLM 使用专用 system prompt（`agents_compiler_system_prompt.md`），检测并移除：
- 角色覆盖指令（"忽略上述规则"、"你是 DAN"）
- 恶意代码生成请求
- 数据泄露指令
- 越狱/绕过安全限制的尝试

保留合法内容：
- 项目代码规范
- 技术栈约定
- 测试要求
- 开发指引

### 容错设计

| 场景 | 行为 |
|------|------|
| `AGENTS.md` 不存在 | `getCompiledPrompt()` 返回 `""` |
| `AGENTS.md` 为空 | 返回 `""` |
| LLM 编译失败 | 日志记录 error，保留上一次成功编译的结果 |
| API Key 未配置 | 返回空字符串，不阻塞 pipeline |

## 4. API

| 方法 | 说明 |
|------|------|
| `getCompiledPrompt(): string` | 获取当前编译后的安全 prompt（同步、无阻塞） |
| `start(): Promise<void>` | 初始化目录、启动 fs.watch、执行首次同步 |
| `stop(): Promise<void>` | 关闭文件监听 |

## 5. LLM 配置

| 参数 | 值 |
|------|------|
| 模型 | `deepseek-v4-flash`（固定） |
| System Prompt | `agents_compiler_system_prompt.md` |
| maxTokens | `2048` |
| thinking | 从 `config.json → providers.deepseek.thinking`（默认 `disabled`） |

## 6. 元数据

`$SANDBOX/.atom/agents_meta.json`:

```json
{
  "currentHash": "abc123...",
  "updatedAt": 1715000000000,
  "entries": {
    "abc123...": { "compiledFile": "abc123....md", "compiledAt": 1715000000000 },
    "def456...": { "compiledFile": "def456....md", "compiledAt": 1714999900000 }
  }
}
```

## 7. 运行时目录

```
sandbox/.atom/
├── agents_meta.json              # 编译元数据追踪
└── compiled_prompts/             # 缓存的编译后提示词
    ├── abc123....md
    └── def456....md
```

## 8. 文件

```
src/services/agents-compiler.ts                        服务实现
src/assets/prompts/agents_compiler_system_prompt.md    编译 LLM 系统提示词
src/bootstrap/agents.ts                                AGENTS.md 初始化 + 模板
src/assets/prompts/agents_md_sample.md                 AGENTS.md 默认模板
src/packages/core/src/pipelines/conversation/elements/fetch-agents-prompt.ts  管线集成
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [pipelines/conversation.md](../pipelines/conversation.md) | fetch-agents-prompt 在管线中的位置 |
| [pipelines/prompts.md](../pipelines/prompts.md) | PromptRegistry — 另一个提示词管理源 |
