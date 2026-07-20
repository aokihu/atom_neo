# Protocol Specification

> **Purpose**: Define the WebSocket event protocol for Core ↔ Client communication.
> All events are JSON-serializable. Field names use camelCase.

---

## 1. Transport

- **Core Side**: WebSocket server at `ws://host:port/ws/:sessionId`
- **Gateway Side**: HTTP reverse proxy. Verifies JWT for `/api/*` routes, validates Client Token for `/gateway/*` routes. Forwards authenticated requests to Core. WebSocket connections bypass Gateway and connect directly to Core.
- **TUI Side**: Direct WebSocket connection to Core (localhost, no auth)
- **Message Format**: JSON, one message per frame
- **Session Routing**: Task-scoped `event.transport.*` events carry `sessionId` and `taskId`, and Core only sends them to clients connected through the matching `/ws/:sessionId` endpoint. System-level events such as MCP status remain global.
- **Session Path Encoding**: Clients must encode `sessionId` with `encodeURIComponent()` before placing it in `/ws/:sessionId` or `/api/sessions/:sessionId`. Core treats it as one URL path segment and applies `decodeURIComponent()` exactly once before Session lookup. Empty IDs, malformed percent escapes, and unencoded extra path segments are rejected with `400`.

```typescript
const encodedSessionId = encodeURIComponent(sessionId);
const ws = new WebSocket(`${coreUrl}/ws/${encodedSessionId}`);
```

---

## 2. Common Envelope

```typescript
// All messages follow this envelope:
type WSMessage<T extends string, P = Record<string, unknown>> = {
  type: T;
  seq: number;       // Sender-assigned sequence number
  ts: number;        // Unix timestamp ms
  payload: P;
};
```

Client → Core 消息由 Client 自行分配 `seq`。Core → Client 消息由同一个 WebSocket
Broadcaster 在进程生命周期内统一分配严格递增的 `seq`：

- 每个逻辑消息只分配一次序号；
- 同一次全局或 Session 广播的所有接收者看到相同序号；
- Session 客户端可能看到序号间隙，因为其他 Session 的定向消息仍会占用全局序号；
- 客户端可使用 `seq` 判断乱序或重复，但不能要求收到的序号连续。

---

## 3. Client → Core Events

### 3.1 `task.submit`

```typescript
{
  type: "event.task.submit",
  seq: 0,            // Client assigns
  ts: 1700000000000,
  payload: {
    sessionId: string;
    chatId: string;
    pipeline: string;      // "conversation" | "prediction" | "follow-up"
    source: TaskSource;     // TaskSource.EXTERNAL | TaskSource.INTERNAL
    data: {                // Pipeline-specific input data
      text?: string;       // User message text
      toolReport?: TaskToolReport;
    }
  }
}
```

### 3.2 `task.cancel`

```typescript
{
  type: "event.task.cancel",
  seq: 0,
  ts: 1700000000000,
  payload: {
    taskId: string;
  }
}
```

Core 从当前 WebSocket 的 `/ws/:sessionId` 连接读取 Session 归属，不信任客户端 payload
提供的 Session。只有 `taskId` 属于当前 Session 时才能取消。Core 使用该 Task 的
`chainId` 作为取消边界：

- 同一 Chain 的排队任务：全部从 TaskQueue 移除；
- 同一 Chain 的执行中任务：全部触发 Task AbortSignal；
- 同一 Chain 的 staged 派生任务：全部从 Orchestrator 丢弃；
- 其他 Session 或不存在的任务：返回错误，不泄露其他 Session 的任务状态。

成功取消后的成员 Task 状态为 `cancelled`。用户取消属于最高优先级控制操作，不等待普通
Task 调度顺序，也不会让 Prediction、Conversation 或 post-conversation 的后续成员残留。

### 3.3 `ping`

```typescript
{
  type: "ping",
  seq: 0,
  ts: 1700000000000,
  payload: {}
}
```

---

## 4. Core → Client Events

### 4.1 `task.created`

```typescript
{
  type: "event.task.created",
  seq: 1,
  ts: 1700000000001,
  payload: {
    taskId: string;
    state: "waiting" | "pending" | "processing";
  }
}
```

### 4.2 `task.state-changed`

```typescript
{
  type: "event.task.state-changed",
  seq: 2,
  ts: 1700000000002,
  payload: {
    taskId: string;
    previousState: string;
    currentState: string;    // waiting|pending|processing|completed|failed|cancelled|follow_up|dispatched|suspended
  }
}
```

### 4.3 `pipeline.element.started`

```typescript
{
  type: "event.pipeline.element.started",
  seq: 3,
  ts: 1700000000003,
  payload: {
    taskId: string;
    elementName: string;
    elementKind: string;    // source | transform | boundary | sink
  }
}
```

### 4.4 `pipeline.element.finished`

```typescript
{
  type: "event.pipeline.element.finished",
  seq: 4,
  ts: 1700000000004,
  payload: {
    taskId: string;
    elementName: string;
    elementKind: string;
    durationMs: number;
  }
}
```

### 4.5 `transport.delta`

```typescript
{
  type: "event.transport.delta",
  seq: 5,
  ts: 1700000000005,
  payload: {
    sessionId: string;
    taskId: string;
    textDelta: string;       // Incremental visible text
    offset: number;          // Position in the full message text where this delta starts
  }
}
```

TUI 使用 `offset` 进行位置感知组装：

```typescript
// 替代简单的 content + textDelta
content = content.substring(0, offset) + textDelta;
```

这确保即使消息乱序到达或 server 端 buffer 切片产生边界重叠，TUI 也能正确拼接完整文本。

### 4.6 `transport.tool.started`

```typescript
{
  type: "event.transport.tool.started",
  seq: 6,
  ts: 1700000000006,
  payload: {
    sessionId: string;
    taskId: string;
    toolName: string;
    toolCallId: string;
    input: unknown;         // Tool-specific input
  }
}
```

### 4.7 `transport.tool.finished`

```typescript
{
  type: "event.transport.tool.finished",
  seq: 7,
  ts: 1700000000007,
  payload: {
    sessionId: string;
    taskId: string;
    toolName: string;
    toolCallId: string;
    result?: unknown;       // Tool output when execution completes
    error?: unknown;        // Present when execution fails
  }
}
```

Tool 是否成功由 `error` 是否存在判断：成功事件携带 `result`，失败事件携带 `error`。
执行耗时、Tool 来源与聚合成功数属于 Core 内部观测或 step/group 汇总信息，不在单次
ToolFinished WebSocket payload 中重复发送。Builtin 与 MCP Tool 必须使用相同的失败语义。

`event.transport.reason`、`event.transport.tool.step-finished` 和
`event.transport.tool.group-complete` 遵循相同的归属规则：payload 必须包含产生事件的
`sessionId` 与 `taskId`，并且只能发送到对应 Session 的 WebSocket 客户端。

### 4.8 `task.completed`

```typescript
{
  type: "event.task.completed",
  seq: 8,
  ts: 1700000000008,
  payload: {
    taskId: string;
    rootTaskId: string;       // Original external request / Task chainId
    parentTaskId: string | null;
    terminal: boolean;        // true only when no downstream Task remains
    output: string;
    reasoningContent: string;
    tokenUsage: { total: number }; // 累计模型消费
    contextTokens: number;         // 当前 Context 窗口估算值，TUI 使用此字段
  }
}
```

`task.completed` 表示当前 Task 成功完成，但不一定表示整条用户请求已经结束。Core 在提交
当前 Task 后检查是否释放了下游 Task，并显式设置 `terminal`：

| 当前 Task 提交结果 | `terminal` | 客户端行为 |
|---|---:|---|
| 已产生 Prediction、Conversation、Post-Conversation 或其他下游 Task | `false` | 继续按 `rootTaskId` 等待 |
| 没有任何下游 Task，整条请求到达成功终态 | `true` | 结束对应请求的 pending Promise |

客户端必须用 `rootTaskId` 关联原始请求，并且只能在 `terminal === true` 时结束成功请求。
禁止根据 `parentTaskId`、Task 层级或“第一个子 Task”推测请求是否结束。

`tokenUsage.total` 与 `contextTokens` 不得混用：前者是累计消费统计，后者是当前窗口大小。
Context Compress 完成后 Core 会广播重新计算的 `contextTokens`，客户端必须用它刷新 Context
占用率。

### 4.9 `task.failed`

```typescript
{
  type: "event.task.failed",
  seq: 9,
  ts: 1700000000009,
  payload: {
    taskId: string;
    rootTaskId: string;  // Task chainId: original external task, or this task for independent work
    code?: string;       // PIPELINE_ABORTED | API_KEY_INVALID | other stable failure code
    error: string;
  }
}
```

`task.failed` 是失败终态。客户端按 `rootTaskId` 匹配并结束对应请求；找不到对应请求时忽略
该失败通知，不能按 FIFO 移除其他请求。

当模型 Provider 返回 HTTP 401 时，Conversation Finalize 在释放 Context Snapshot 后将其转换为
`API_KEY_INVALID` 失败终态。TUI 必须显示阻塞式错误 Modal，提示用户更新 API Key；不得把它当作
空的 `task.completed` 静默结束，也不得自动重试无效凭据。其他 `task.failed` 继续使用普通消息错误展示。

### 4.10 `pong`

```typescript
{
  type: "pong",
  seq: 10,
  ts: 1700000000010,
  payload: {}
}
```

---

## 5. Pipeline Replay Events

### 5.1 `replay.start`

```typescript
{
  type: "event.pipeline.replay-start",
  seq: 0,
  ts: 1700000000000,
  payload: {
    sessionId: string;
    taskId: string;
  }
}
```

### 5.2 `replay.event`

```typescript
// Emitted for each recorded event during replay
{
  type: "replay.event",
  seq: 1,
  ts: 1700000000001,
  payload: {
    taskId: string;
    event: WSServerEvent;   // Any of the above server events
  }
}
```

### 5.3 `replay.end`

```typescript
{
  type: "event.pipeline.replay-end",
  seq: 999,
  ts: 1700000000100,
  payload: {
    sessionId: string;
    taskId: string;
    totalEvents: number;
  }
}
```

---

## 6. Event Type Registry (Do Not Edit Manually)

```typescript
// src/packages/shared/src/protocol.ts

export const ClientEventTypes = [
  "task.submit",
  "task.cancel",
  "ping",
] as const;

export const ServerEventTypes = [
  "task.created",
  "task.state-changed",
  "pipeline.element.started",
  "pipeline.element.finished",
  "transport.delta",
  "transport.tool.started",
  "transport.tool.finished",
  "task.completed",
  "task.failed",
  "pong",
  "replay.start",
  "replay.event",
  "replay.end",
] as const;

export type ClientEventType = (typeof ClientEventTypes)[number];
export type ServerEventType = (typeof ServerEventTypes)[number];
```

---

## 7. Gateway Authentication

Gateway 提供两类路由，使用不同的验证机制：

### 7.1 `/api/*` — JWT Bearer Token

外部用户（TUI、HTTP API 调用者）通过 JWT Bearer Token 访问：

```
POST /api/tasks
Authorization: Bearer eyJhbG...

// JWT payload:
{
  sub: "user-id",
  permissionLevel: 0 | 1 | 2,
  exp: 1700000000,
  iat: 1699996400,
}
```

### 7.2 `/gateway/*` — Client Token

内部 Client 子进程通过 Gateway 启动时分配的一次性随机 Token 验证：

```
POST /gateway/status
Authorization: Bearer 550e8400-e29b-41d4-a716-446655440000
```

Token 由 `crypto.randomUUID()` 在 Client 子进程启动时生成，仅存在于 Gateway 内存。Client 崩溃重启时自动轮换。

### 7.3 WebSocket

WebSocket 连接不经过 Gateway。TUI 客户端直接连接 Core 的 `/ws/:sessionId` 端点。Gateway 仅代理 HTTP API 调用。

---

## 8. Error Event Details

```typescript
// Common error codes:
"PIPELINE_ABORTED"          // Signal cancelled
"ELEMENT_FAILED"            // Element threw an error
"TOOL_PERMISSION_DENIED"    // Tool level exceeds permission
"RATE_LIMIT_EXCEEDED"       // Gateway rate limit hit
"SESSION_NOT_FOUND"         // Invalid session ID
"INVALID_PAYLOAD"           // Message fails validation
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [error-handling.md](./error-handling.md) | 错误跨层传播模型 |
| [pipeline-dev.md](../core/pipeline-dev.md#part-3-event-bus) | 事件类型与 WebSocket 消息的映射 |
| [architecture.md](../overview/architecture.md) | WebSocket 在系统架构中的位置 |
