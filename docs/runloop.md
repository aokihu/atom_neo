# TaskEngine Runloop — 任务状态机

> **版本**: v0.6.0 → 移除 tool tier 分层，所有工具一次性加载

---

## 方案：FinalizeElement 统一收口 + chainAction

链任务创建逻辑内聚在 `FinalizeElement`，用单一 `chainAction` 字段表达链类型：

```
ConversationFlowState {
  chainAction?: "follow_up";  // 可扩展
}
```

### chainAction 设置顺序（按 pipeline element 执行序）

| Element | 设置 | 条件 | 优先级 |
|---------|------|------|--------|
| stream-llm | `chainAction = "follow_up"` | `finishReason === "length"` (输出被截断) | 低 |

### FinalizeElement 消费

```typescript
FinalizeElement.doProcess():
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
  └─ pipeline 执行 (9 elements)
       │
       ├─ stream-llm:      chainAction = "follow_up" (if truncated)
       ├─ check-follow-up: 处理 intent (FOLLOW_UP, KEEP_MEMORY)
       └─ FinalizeElement:
            ├─ "follow_up"  → 创建续写任务   → ActiveQueue
            └─ return complete
```

## server.ts 简化

- 只负责日志、广播、session 存储
- 不再需要 tool 层级或 buildChainPipeline

## 关键约束

- `FinalizeElement` 不等待链任务执行 — 只创建和入队
- 双队列保证链任务不被打断 — [queue.md](./queue.md)
- `chainAction` 只在 pipeline 内部流转，不出 pipeline

## 安全门：chainDepth 防无限循环

```
MAX_FOLLOW_UP_DEPTH = 5

Task (depth=0) → pipeline 执行 → FinalizeElement
  ├─ depth >= 5 ? → 停止
  └─ depth < 5  ? → 创建链任务 (depth+1) → ActiveQueue
```

- `depth` 存储在每个 pipeline 实例的 deps 中，由 server.ts 维护
- FinalizeElement 创建链任务时通过 orchestrator 自动递增 depth
- 上限可配置：`maxChainDepth` 常量
