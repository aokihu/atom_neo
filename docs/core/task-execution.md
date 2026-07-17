# Task Execution

> **Purpose**: 双队列系统 + TaskEngine 状态机 — 链式任务不被用户消息打断的核心机制。

---

## 1. 优先级双队列系统

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
│    1. 比较两个队列的最高 priority
│    2. 同优先级时 ActiveQueue 优先
│    3. Waiting 同优先级保持 FIFO
│    4. Active 同优先级保持 LIFO
└─────────────────────────────┘
```

### 路由规则

| 操作或任务来源 | 优先级 | 行为 |
|----------------|--------|------|
| 用户取消当前任务链 | `USER_CANCEL = 100` | 控制路径，立即处理，不等待普通 Task 出队 |
| 链式续写及其他内部任务 | `INTERNAL = 50` | ActiveQueue，同优先级 LIFO |
| 用户新消息 | `EXTERNAL = 10` | WaitingQueue，同优先级 FIFO |

取消请求优先级最高。Core 先用 `taskId + sessionId` 定位目标 Task，再读取其 `chainId`，
一次性取消同一 Session、同一 Task Chain 中的全部成员：

- queued：立即从 WaitingQueue / ActiveQueue 移除；
- processing：立即触发每个 Task 的 `AbortSignal`；
- staged：立即丢弃 Orchestrator 中尚未提交的派生 Task。

一个 Session 不能取消另一个 Session 的 Task Chain。独立 Task 的 `chainId` 等于自身 ID，
因此使用同一套取消路径。

### 行为保证

- 当前会话的工具调用链不会被打断
- 用户新消息正常排队，等当前链完成后再处理
- 高优先级 Task 可以在低优先级 Task 之前出队
- 用户取消不等待当前 Pipeline 自然结束
- 同一 Task Chain 不会残留 queued、processing 或 staged 成员
- 被取消的 Task 进入 `cancelled` 状态并释放 Session lease

### API

```typescript
class TaskQueue {
  enqueue(task: TaskItem): void;
  dequeue(): TaskItem | undefined;    // 先比较 priority，再应用 FIFO/LIFO
  cancelChain(taskId: string, sessionId: string): TaskChainCancellation | undefined;
  get waiting(): number;
  get active(): number;
  get processing(): number;
  get size(): number;
}
```

---

## 2. TaskEngine 状态机

### 用户取消

```text
TUI 第一次 ESC
  → 显示“再次按 ESC 取消”

2 秒内第二次 ESC
  → event.task.cancel { taskId }
  → Core 使用 WebSocket sessionId 校验 Task 归属
      ├── 解析目标 Task 的 chainId
      ├── queued members     → 全部从队列移除 → cancelled
      ├── processing members → 全部 AbortController.abort() → cancelled
      ├── staged members     → Orchestrator.discardChain()
      └── 不属于当前 Session / 不存在 → 拒绝
```

`TaskEngine` 在每个 Element 执行前后检查取消信号，并将同一信号传给 LLM 与 Tool。
因此 Bash、WebFetch 和支持 AbortSignal 的 MCP/模型调用可以立即停止；不支持信号的同步
Element 最迟在当前 Element 返回后停止，不会继续执行后续 Element。

取消以 Task Chain 为边界，而不是只处理客户端传入的单个 Task ID。意图预测、
Conversation、follow-up、context-compress 和 post-conversation 只要共享同一
`chainId`，都会被同一次取消覆盖；取消期间不得再提交该 Chain 的 staged Task。

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
