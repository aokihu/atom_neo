# Pipeline Event Bus — Extension & Internals

> **Purpose**: How the Event Bus works internally and how to extend it with custom events.
> The bus is the nervous system — every component communicates through it.

---

## 1. Core Implementation

```typescript
// packages/shared/src/pipeline/event-bus.ts

export class PipelineEventBus<TEvents extends Record<string, any>> {
  #handlers = new Map<string, Set<(...args: any[]) => void>>();
  #errorHandler?: (eventName: string, error: unknown) => void;

  /** Register a handler. Returns an unsubscribe function. */
  on<E extends keyof TEvents & string>(
    eventName: E,
    handler: (payload: TEvents[E]) => void,
  ): () => void {
    if (!this.#handlers.has(eventName)) {
      this.#handlers.set(eventName, new Set());
    }
    this.#handlers.get(eventName)!.add(handler);
    return () => this.#handlers.get(eventName)?.delete(handler);
  }

  /** Emit an event. Handlers run synchronously. Errors are caught. */
  emit<E extends keyof TEvents & string>(
    eventName: E,
    payload: TEvents[E],
  ): void {
    const handlers = this.#handlers.get(eventName);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (error) {
        this.#errorHandler?.(eventName, error);
      }
    }
  }

  /** Set a global error handler for handler errors */
  onHandlerError(handler: (eventName: string, error: unknown) => void): void {
    this.#errorHandler = handler;
  }

  /** Remove all handlers for an event */
  clear(eventName: string): void {
    this.#handlers.delete(eventName);
  }
}
```

**Key design decisions:**
- Handlers are SYNCHRONOUS (prevents blocking the pipeline)
- Errors in one handler don't crash other handlers
- `on()` returns an unsubscribe function (call to remove)
- Single-threaded — no race conditions

---

## 2. Event Type Registration

```typescript
// packages/shared/src/types/pipeline.ts

// Base events (emitted by PipelineRunner and Elements):
export type PipelineEventMap = {
  "element.state-changed": {
    name: string;
    payload: { state: "READY" | "WORKING" | "DONE" | "FAILED" };
  };
  "pipeline.element.started": {
    pipelineName: string;
    elementName: string;
    elementKind: string;
  };
  "pipeline.element.finished": {
    pipelineName: string;
    elementName: string;
    elementKind: string;
    durationMs: number;
  };
  "pipeline.element.failed": {
    pipelineName: string;
    elementName: string;
    elementKind: string;
    durationMs: number;
    error: unknown;
  };
  "element.data": {
    name: string;
    payload: Record<string, unknown>;
  };
};

// Core-level events (emitted by TaskEngine, services):
export type CoreEventMap = {
  "task.enqueued": { task: TaskItem };
  "task.activated": { task: TaskItem };
  "task.completed": { task: TaskItem; result: PipelineResult };
  "task.failed": { task: TaskItem; error: unknown };
  "pipeline.result": { task: TaskItem; result: PipelineResult };
};

// Domain events (emitted by specific elements):
export type DomainEventMap = {
  "intent.parsed": {
    parsedCount: number;
    safeCount: number;
    rejectedCount: number;
  };
  "transport.delta": { textDelta: string };
  "transport.tool.started": { toolName: string; toolCallId: string; input: unknown };
  "transport.tool.finished": { toolName: string; toolCallId: string; result?: unknown; error?: unknown };
  "transport.failed": { error: unknown };
};

// Combined event map:
export type FullEventMap = PipelineEventMap & CoreEventMap & DomainEventMap;
```

---

## 3. How to Register Custom Events

```typescript
// 1. Define the event type in your module's types.ts:
// packages/core/src/session/types.ts

export type SessionEventMap = {
  "session.created": { sessionId: string };
  "session.destroyed": { sessionId: string };
  "session.evicted": { sessionId: string; reason: string };
};

// 2. Extend the global event map:
// packages/shared/src/types/pipeline.ts

export type FullEventMap = PipelineEventMap & CoreEventMap & DomainEventMap & SessionEventMap;

// 3. Use the bus in your code:
bus.emit("session.created", { sessionId });
bus.on("session.destroyed", ({ sessionId }) => {
  mcpManager.disconnectAll(sessionId);
});
```

---

## 4. Bus Usage Patterns

### 4.1 Element → Bus (via report())

```typescript
class MyElement extends BaseElement {
  async doProcess(input: FlowState) {
    this.report("element.data", {
      event: "my-event",
      data: "something happened",
    });
  }
}
```

### 4.2 Service → Bus (direct emit)

```typescript
class TaskEngine {
  #bus: PipelineEventBus<FullEventMap>;

  onTaskFinished(task: TaskItem, result: PipelineResult) {
    this.#bus.emit("task.completed", { task, result });
  }
}
```

### 4.3 External Observer → Bus (client-side via WebSocket)

```typescript
// On the server, bus events are fanned out to WebSocket clients:
bus.on("task.activated", (payload) => {
  broadcaster.send(payload.task.sessionId, {
    type: "task.state-changed",
    payload: { taskId: payload.task.id, currentState: "processing" },
  });
});
```

### 4.4 Cleanup Pattern (off returns unsubscribe function)

```typescript
const offDelta = bus.on("transport.delta", handleDelta);
const offToolStarted = bus.on("transport.tool.started", handleToolStarted);

// Later, when cleaning up:
offDelta();
offToolStarted();
```

---

## 5. Thread Safety in Event Bus

```typescript
// PipelineEventBus is DESIGNED to be single-threaded (EventEmitter model).
// Handlers run synchronously during emit().
// If you need async handling:

// BAD (blocks the bus):
bus.on("task.completed", async (payload) => {
  await saveToDatabase(payload);  // Blocks all other handlers!
});

// GOOD (delegate to task queue):
bus.on("task.completed", (payload) => {
  taskQueue.enqueueBackgroundJob(() => saveToDatabase(payload));
});
```

---

## 6. Testing Event Bus

```typescript
test("bus emits and handles events", () => {
  const bus = new PipelineEventBus<TestEventMap>();
  const handler = mock(() => {});

  const off = bus.on("test.event", handler);
  bus.emit("test.event", { data: "hello" });

  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith({ data: "hello" });

  off();
  bus.emit("test.event", { data: "world" });
  expect(handler).toHaveBeenCalledTimes(1);  // Still only called once
});

test("bus catches handler errors", () => {
  const bus = new PipelineEventBus<TestEventMap>();
  const errorHandler = mock(() => {});
  bus.onHandlerError(errorHandler);

  bus.on("test.event", () => { throw new Error("boom"); });
  bus.emit("test.event", {});

  expect(errorHandler).toHaveBeenCalledTimes(1);
});
```
