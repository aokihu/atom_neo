# Task Queue — 双队列系统

> **版本**: v0.5.3 — 解决链式任务被用户消息插队的正确性问题

---

## 问题

单优先级队列下，用户随时发新消息可能打断正在执行的工具调用链：

```text
现在: [用户消息1] [用户消息2] [工具链任务3] [用户消息4]
        ↑ 工具链任务3 被用户消息4 插队，上下文错乱
```

## 设计

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

## 路由规则

| 任务来源 | `TaskSource` | 入队 |
|----------|-------------|------|
| 用户发消息 | `EXTERNAL` | WaitingQueue (FIFO) |
| needMoreTools 续接 | `INTERNAL` | ActiveQueue (LIFO) |
| 其他内部衍生任务 | `INTERNAL` | ActiveQueue (LIFO) |

## 行为保证

- 当前会话的工具调用链不会被打断
- 用户新消息正常排队，等当前链完成后再处理
- ActiveQueue 为空时不阻塞外部任务
- `remove(taskId)` 从两个队列中查找并移除

## 关键方法

```typescript
class TaskQueue {
  enqueue(task: TaskItem): void;
  // EXTERNAL → WaitingQueue, INTERNAL → ActiveQueue

  dequeue(): TaskItem | undefined;
  // ActiveQueue 优先，再取 WaitingQueue

  remove(taskId: string): boolean;
  // 从两个队列中删除

  get waiting(): number;   // WaitingQueue 长度
  get active(): number;    // ActiveQueue 长度
  get processing(): number; // 正在执行的任务数
  get size(): number;      // 总任务数
}
```
