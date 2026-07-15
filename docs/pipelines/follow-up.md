# Follow-Up Pipeline

> **Purpose**: 链式续写的轻量转换管道 — 将 conversation pipeline 的后续任务 payload 标准化为 continuation 消息注入。

## 职责

当 `finalize` 发出 `Conversation.Chain` 事件后，server.ts 调用 `orchestrator.scheduleFollowUp()` 创建新的 task（pipeline: `"conversation"`，source: `INTERNAL`，payload: `"请从上次中断处继续，不要重复已输出的内容。"`）。此 follow-up pipeline 是一条 2-element 的轻量管线，将该 payload 准备为可被 conversation pipeline 消费的状态。

## Element 链

```
follow-up-source (source) → follow-up-sink (sink)
```

| 顺序 | Element | Kind | 职责 |
|------|---------|------|------|
| 1 | `follow-up-source` | source | 将 mode 从 `initial` 切换到 `asking` |
| 2 | `follow-up-sink` | sink | 输出 `type: "complete"` |

## FlowState

```typescript
type FollowUpMode = "initial" | "asking";

// FollowUpSourceElement: initial → asking
// FollowUpSinkElement: asking → complete
```

## 状态转移

```
initial
  → follow-up-source: mode 切换 → asking
  → follow-up-sink:   完成       → PipelineResult { type: "complete" }
```

## 触发条件

server.ts 的 `Conversation.Chain` handler 只在无计划续写场景调度 follow-up：

| 条件 | chainDepth 处理 |
|------|-----------------|
| `action === "follow_up"` 且 depth 未超限 | incrementChainDepth → scheduleFollowUp |
| `action === "post_check_retry"` 且 depth 未超限 | incrementChainDepth → scheduleFollowUp |

Active TODO 不属于 follow-up。它使用 `action === "continue_todo"` 和独立的 TODO continuation 提示；两者只共用 `Conversation.Chain` 这一调度通道。

## 设计要点

| 机制 | 说明 |
|------|------|
| **最小管线** | 仅 2 个元素，无 transform 逻辑 — 只做状态转换 |
| **Payload 传递** | 使用固定 continuation 提示词 `"请从上次中断处继续，不要重复已输出的内容。"` |
| **Task source 区分** | 链式续写的 task source 为 `INTERNAL`（区别于用户输入的 `USER`） |

## 文件

```
src/packages/core/src/pipelines/follow-up/
  index.ts    pipeline 定义 + FollowUpSourceElement + FollowUpSinkElement
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [conversation.md](./conversation.md) | 触发 follow-up 的 chain 事件来源 |
| [post-conversation.md](./post-conversation.md) | post_check_retry 触发链 |
| [follow-up-evaluator.md](./follow-up-evaluator.md) | 健康评估如何影响链式续写 |
