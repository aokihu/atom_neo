# Task Execution

> **Purpose**: 双队列系统 + TaskEngine 状态机 — 链式任务不被用户消息打断的核心机制。

---

## 1. 双队列系统

### 问题

单优先级队列下，用户随时发新消息可能打断正在执行的工具调用链：

```text
现在: [用户消息1] [用户消息2] [工具链任务3] [用户消息4]
        ↑ 工具链任务3 被用户消息4 插队，上下文错乱
```

### 设计

```
┌─────────────────────────────┐
│         TaskQueue           │
│                             │
│  WaitingQueue (FIFO)        │
│  ┌───────────────────────┐  │
│  │ [ext-1] [ext-2] [ext-3]│  │  ← 外部用户消息，先进先出
│  └───────────────────────┘  │
│                             │
│  ActiveQueue (LIFO)         │
│  ┌───────────────────────┐  │
│  │ [chain-3] [chain-2] [chain-1]  │  │  ← 链内任务，后进先出
│  └───────────────────────┘  │
│                             │
│  dequeue():                 │
│    1. ActiveQueue 有任务 → 取 ActiveQueue
│    2. ActiveQueue 空     → 取 WaitingQueue
└─────────────────────────────┘
```

### 路由规则

| 任务来源 | `TaskSource` | 入队 |
|----------|-------------|------|
| 用户发消息 | `EXTERNAL` | WaitingQueue (FIFO) |
| 链式续写任务 (follow_up) | `INTERNAL` | ActiveQueue (LIFO) |
| 其他内部衍生任务 | `INTERNAL` | ActiveQueue (LIFO) |

### 行为保证

- 当前会话的工具调用链不会被打断
- 用户新消息正常排队，等当前链完成后再处理
- ActiveQueue 为空时不阻塞外部任务
- `remove(taskId)` 从两个队列中查找并移除

### API

```typescript
class TaskQueue {
  enqueue(task: TaskItem): void;
  dequeue(): TaskItem | undefined;    // ActiveQueue 优先，再取 WaitingQueue
  remove(taskId: string): boolean;    // 从两个队列中删除
  get waiting(): number;
  get active(): number;
  get processing(): number;
  get size(): number;
}
```

---

## 2. TaskEngine 状态机

### chainAction 统一收口

链任务创建逻辑内聚在 `FinalizeElement`，用单一 `chainAction` 字段表达链类型：

```
ConversationFlowState {
  chainAction?: "follow_up";  // 可扩展
}
```

### chainAction 设置顺序

| Element | 设置 | 条件 | 优先级 |
|---------|------|------|--------|
| stream-llm | `chainAction = "follow_up"` | `finishReason === "length"` | 低 |

### 数据流

```
TaskEngine.#processNext()
  └─ pipeline 执行 (9 elements)
       │
       ├─ stream-llm:      chainAction = "follow_up" (if truncated)
        ├─ check-follow-up: 处理 intent (FOLLOW_UP, RETAIN_MEMORY)
       └─ FinalizeElement:
            ├─ "follow_up"  → 创建续写任务   → ActiveQueue
            └─ return complete
```

### 扩展新链类型

只需：加一个字符串值 → 在 FinalizeElement 加一个分支。不改 FlowState 字段，不改 server.ts。

### server.ts 简化

- 只负责日志、广播、session 存储
- 不再需要 tool 层级或 buildChainPipeline

---

## 3. chainDepth 防无限循环

```
MAX_FOLLOW_UP_DEPTH = 5

Task (depth=0) → pipeline 执行 → FinalizeElement
  ├─ depth >= 5 ? → 停止
  └─ depth < 5  ? → 创建链任务 (depth+1) → ActiveQueue
```

- `depth` 存储在每个 pipeline 实例的 deps 中，由 server.ts 维护
- FinalizeElement 创建链任务时通过 orchestrator 自动递增 depth
- 上限可配置：`maxChainDepth` 常量

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [../pipelines/conversation.md](../pipelines/conversation.md) | Conversation Pipeline — chainAction 如何触发 |
| [pipeline-dev.md](./pipeline-dev.md) | FinalizeElement 的 chainAction 调度逻辑 |
| [session.md](./session.md) | SessionContext 与任务执行的关系 |
