# Follow-Up Pipeline

> **状态：死代码。** 此 Pipeline 已注册但无触发路径。`InternalTaskOrchestrator.scheduleFollowUp()` 实际创建 `"conversation"` 任务，不使用此 Pipeline。保留此文档供历史参考。

## 职责（原设计）

处理链式续写的简化封装。

## Element 链

```
follow-up-source (source) → follow-up-sink (sink)
```

| 顺序 | Element | Kind | 职责 |
|------|---------|------|------|
| 1 | `follow-up-source` | source | 检查 mode，设置为 `asking` |
| 2 | `follow-up-sink` | sink | 直接返回 `{ type: "complete" }` |

## FlowState

无显式类型（使用 `BaseElement<any, any>`）。

## 状态转移

```
initial → [follow-up-source] → asking → [follow-up-sink] → PipelineResult
```

## 为何未使用

1. `InternalTaskOrchestrator.scheduleFollowUp()` 创建 `pipeline: "conversation"` 任务，而非 `"follow-up"`
2. `server.ts` 的 `pipelineBuilders` 中无 `"follow-up"` 条目
3. 实际上被 conversation pipeline + `BusEvents.Conversation.Chain` 事件系统替代

## 元素定义

两个元素均内联定义在 `index.ts` 中，无独立文件，无 `elements/` 目录。

## 文件

```
src/packages/core/src/pipelines/follow-up/
  index.ts                          pipeline 定义 + 内联 element 类
```
