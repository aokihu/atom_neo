# Protocol Specification

> **Purpose**: Define the WebSocket event protocol for Core ↔ Client communication.
> All events are JSON-serializable. Field names use camelCase.

---

## 1. Transport

- **Core Side**: WebSocket server at `ws://host:port/ws/:sessionId`
- **Gateway Side**: Proxies WebSocket connections, verifies JWT in initial handshake
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
  type: "task.submit",
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
  type: "task.cancel",
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
  type: "task.created",
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
  type: "task.state-changed",
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
  type: "pipeline.element.started",
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
  type: "pipeline.element.finished",
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
  type: "transport.delta",
  seq: 5,
  ts: 1700000000005,
  payload: {
    taskId: string;
    textDelta: string;       // Incremental visible text
  }
}
```

### 4.6 `transport.tool.started`

```typescript
{
  type: "transport.tool.started",
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
  type: "transport.tool.finished",
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
  type: "task.completed",
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
  type: "task.failed",
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
  type: "replay.start",
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
  type: "replay.end",
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
// packages/shared/src/protocol.ts

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

```typescript
// Gateway validates JWT during WebSocket upgrade:
// Request: GET ws://gateway:3000/ws/:sessionId
// Headers: Authorization: Bearer <jwt>

// JWT payload:
{
  sub: "user-id",
  sessionId: "session-id",
  permissions: 0 | 1 | 2,   // PermissionLevel
  exp: 1700000000,
  iat: 1699996400,
}
```

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
