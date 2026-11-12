# Conversation Stream Runtime

`stream-llm.ts` 的 Element shell 只保留构造与 `doProcess` 委托；本目录承载一次 Conversation Stream 的完整行为边界。

| 文件 | 职责 |
|---|---|
| `types.ts` | `StepOutcome`、`StreamRun`、`StreamConfig`、步骤/上下文/上报的最小结构类型 |
| `stream-run.ts` | 一次 `doProcess` 的运行装配：TODO/continuation、工具集合、模型、Snapshot、deadline、`StreamRun` |
| `stream-loop.ts` | `while` 主循环、governance stop、force text、退出原因、batch 交接 |
| `stream-step.ts` | 单次 `beforeCall` + `streamText` + chunk 分类 + usage timeout；`StreamDeadline` |
| `stream-context.ts` | 每 step Snapshot refresh、usage commit、release、Tool Context 注入、StepCompleted |
| `stream-reporting.ts` | Transport/Trace、usage/cache、model-step payload 组装 |
| `stream-reporting-events.ts` | loop-ended/done、stream error/abort/usage error、ToolGroupComplete payload |
| `stream-finalize.ts` | group seal、loop ended、intents、最终 FlowState 投影 |
| `stream-overflow.ts` | 0.8 Token overflow 判定与提前返回结果 |
| `stream-model-input.ts` | 模型输入、cache/token/effect 投影、record policy、Tool Context scope |
| `tool-result-status.ts` | `ToolStatusCollector`（按 Tool 名 FIFO）、MCP metadata 归一 |
| `tool-governance-runtime.ts` | `begin/finishGovernedToolCall` 与治理事件 |
| `tool-runtime.ts` | 内置 Tool 适配 + 统一 `executeGovernedTool` |
| `tool-runtime-mcp.ts` | MCP Tool 适配（复用 `executeGovernedTool`） |
| `tool-batch.ts` | batch 校验、intent 特判、executor、消息投影 |
| `tool-batch-record.ts` | 工具结果记录、transport finish、context injection、todowrite handoff |
| `tool-batch-block.ts` | batch 被拒绝时的状态、事件与投影 |

依赖方向（单向）：

```text
stream-llm.ts
  -> stream-run.ts
       -> stream-context.ts / stream-step.ts / tool-runtime(-mcp).ts / stream-model-input.ts
  -> stream-loop.ts
       -> stream-step.ts / tool-batch.ts / stream-reporting.ts
  -> stream-finalize.ts
       -> stream-overflow.ts / stream-reporting-events.ts / stream-model-input.ts
tool-batch.ts -> tool-batch-block.ts / tool-batch-record.ts / tool-loop.ts
tool-batch-record.ts -> stream-model-input.ts
stream-step.ts -> stream-reporting.ts / stream-reporting-events.ts
```

禁止事项：

- `stream-llm.ts` 不直接调用 `streamText`、不执行 Tool、不组装 usage/loop/done payload。
- `stream-step.ts` 不执行 Tool；`tool-batch.ts` 不构造模型；`stream-reporting.ts` 不决定业务分支。
- `stringifyToolOutput` 只在 `tool-loop.ts` 定义；tool runtime 从那里导入。
- Tool 结果通过 `StreamRun`/返回值显式传递，不用跨模块 `Map` 侧信道。
- 事件名、payload 字段顺序、Tool governance 文案、timeout/abort、token usage 与最终 FlowState 字段不得改变。
