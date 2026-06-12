# Protocol Specification

> **Purpose**: Define the WebSocket event protocol for Core ↔ Client communication.
> All events are JSON-serializable. Field names use camelCase.

---

## 1. Transport

- **Core Side**: WebSocket server at `ws://host:port/ws/:sessionId`
- **Gateway Side**: HTTP reverse proxy. Verifies JWT for `/api/*` routes, validates Client Token for `/gateway/*` routes. Forwards authenticated requests to Core. WebSocket connections bypass Gateway and connect directly to Core.
- **TUI Side**: Direct WebSocket connection to Core (localhost, no auth)
- **Message Format**: JSON, one message per frame

---

## 2. Common Envelope

```typescript
// All messages follow this envelope:
type WSMessage<T extends string, P = Record<string, unknown>> = {
  type: T;
  seq: number;       // Monotonic sequence number (Core assigns)
  ts: number;        // Unix timestamp ms
  payload: P;
};
```

---

## 3. Client → Core Events

### 3.1 `task.submit`

```typescript
{
  type: "event.task.submit",
  seq: 0,            // Client assigns, Core echoes in response
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
    currentState: string;    // waiting|pending|processing|completed|failed|follow_up|dispatched|suspended
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
    taskId: string;
    toolName: string;
    toolSource: string;     // builtin | plugin | mcp
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
    taskId: string;
    toolName: string;
    toolSource: string;
    toolCallId: string;
    ok: boolean;
    output?: string;        // Tool result text
    error?: string;         // Error message if failed
    durationMs: number;
  }
}
```

### 4.8 `task.completed`

```typescript
{
  type: "event.task.completed",
  seq: 8,
  ts: 1700000000008,
  payload: {
    taskId: string;
    result: {
      type: string;         // complete | enqueue | suspend_and_enqueue_child | resume_parent_and_enqueue
      transition?: string;  // follow_up | dispatch
      childTaskId?: string;
      parentTaskId?: string;
    }
  }
}
```

### 4.9 `task.failed`

```typescript
{
  type: "event.task.failed",
  seq: 9,
  ts: 1700000000009,
  payload: {
    taskId: string;
    error: {
      message: string;
      elementName?: string;  // Which element failed
      code?: string;         // Machine-readable error code
    }
  }
}
```

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
