# TaskEngine Runloop — 任务状态机

> **版本**: v0.5.3 → FinalizeElement 统一收口 + chainAction 扩展

---

## 问题

当前 `needMoreTools` 链式续接逻辑散落在 `server.ts` 的 `bus.on("task.completed")` handler 中，跨越 TaskEngine → server.ts 两个文件的回调跳转。每新增一种链任务类型（续写、记忆检索等）都需要加新的 boolean 字段和 server.ts 代码。

## 方案：FinalizeElement 统一收口 + chainAction

将链任务创建逻辑从 `server.ts` 内聚到 `FinalizeElement`，用单一 `chainAction` 字段表达所有链类型：

```
ConversationFlowState {
  chainAction?: "more_tools" | "follow_up";  // 可扩展
}
```

### chainAction 设置顺序（按 pipeline element 执行序）

| Element | 设置 | 条件 | 优先级 |
|---------|------|------|--------|
| stream-llm | `chainAction = "follow_up"` | `finishReason === "length"` (输出被截断) | 低 |
| check-follow-up | `chainAction = "more_tools"` | intent 中检测到 REQUEST_MORE_TOOLS | 高（覆盖） |

### FinalizeElement 消费

```typescript
FinalizeElement.doProcess():
  if chainAction === "more_tools":
    → 创建链任务 (tools: basic+advanced, payload: 空)
  if chainAction === "follow_up":
    → 创建续写任务 (payload: "请从上次中断处继续")
  → enqueue → ActiveQueue (LIFO)
  → return { type: "complete", ... }
```

### 扩展新链类型

只需：加一个字符串值 → 在 FinalizeElement 加一个分支。不改 FlowState 字段，不改 server.ts。

## 数据流

```
TaskEngine.#processNext()
  └─ pipeline 执行 (10 elements)
       │
       ├─ stream-llm:      chainAction = "follow_up" (if truncated)
       ├─ parse-intents:   (只解析)
       ├─ check-follow-up: chainAction = "more_tools" (覆盖)
       └─ FinalizeElement:
            ├─ "more_tools" → 创建工具链任务 → ActiveQueue
            ├─ "follow_up"  → 创建续写任务   → ActiveQueue
            └─ return complete
```

## server.ts 简化

- 只负责日志、广播、session 存储
- 不再知道 needMoreTools / chainAction / tool 层级
- `buildChainPipeline` 回调传给 FinalizeElement

## 关键约束

- `FinalizeElement` 不等待链任务执行 — 只创建和入队
- 双队列保证链任务不被打断 — [queue.md](./queue.md)
- `chainAction` 只在 pipeline 内部流转，不出 pipeline
