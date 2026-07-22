# Testing Standards

> **Purpose**: Mandatory testing conventions. All code MUST have corresponding tests.

---

## 1. Framework

- **Test Runner**: Bun's built-in `bun:test`
- **Assertions**: `expect` from `bun:test`
- **Mocking**: `mock` from `bun:test`, `mock.module` for module-level mocking

```typescript
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
```

## 2. File Naming

```text
src/session/context.ts  →  src/session/context.test.ts
src/tools/registry.ts   →  src/tools/registry.test.ts
```

## 3. Test Structure

```typescript
describe("ModuleName", () => {
  // Setup
  let module: ModuleName;

  beforeEach(() => {
    module = new ModuleName({ /* deps */ });
  });

  // Happy path
  test("does the expected thing under normal conditions", async () => {
    const result = await module.method(input);
    expect(result).toBe(expected);
  });

  // Error case
  test("throws when invalid input is provided", () => {
    expect(() => module.method(invalid)).toThrow();
  });

  // Edge case
  test("handles empty input gracefully", async () => {
    const result = await module.method(emptyInput);
    expect(result).toBeDefined();
  });
});
```

## 4. Test Naming Rules

```text
# Test name format: "does <X> when <condition>"
test("returns task when pipeline completes")
test("throws when element is not registered")
test("passes through on mismatched mode")
test("falls back to default when LLM output is invalid")

# NEVER:
test("test task")            # Too vague
test("it works")             # Not descriptive
test("should work")          # Should → does
```

## 5. Mocking Rules

```typescript
// External module mocking:
mock.module("ai", () => ({
  streamText: mockStreamText,
  generateText: mockGenerateText,
}));

// Local function mocking:
const mockDep = mock(async () => expectedResult);

// NEVER mock what you don't own unless it's an external service (LLM, DB, HTTP)
// Prefer real implementations for internal dependencies

// After each test, reset mocks:
beforeEach(() => {
  mockFn.mockReset();
  mockFn.mockImplementation(async () => defaultResult);
});
```

## 6. Element Testing

```typescript
// Every Element MUST test:

describe("MyElement", () => {
  let bus: PipelineEventBus<PipelineEventMap>;
  let element: MyElement;
  let mockDep: ReturnType<typeof mock>;

  beforeEach(() => {
    bus = new PipelineEventBus<PipelineEventMap>();
    mockDep = mock(async () => expectedResult);
    element = new MyElement({ bus, dep: mockDep as any });
  });

  // 1. Mode gating
  test("passes through when mode is not ExpectedInputMode", async () => {
    const input = { mode: WrongMode } as MyFlowState;
    const result = await element.process(input);
    expect(result).toBe(input);
  });

  // 2. Correct processing
  test("processes and transitions when mode matches", async () => {
    const input = { mode: MyMode.ExpectedInputMode, ... } as MyFlowState;
    const result = await element.process(input);
    expect(result.mode).toBe(MyMode.NextOutputMode);
  });

  // 3. Event emission
  test("reports element data on processing", async () => {
    const events: any[] = [];
    bus.on("element.data", (e) => events.push(e));

    await element.process(input);

    expect(events.length).toBeGreaterThan(0);
  });
});
```

## 7. Pipeline Testing

```typescript
// Integration tests for full pipelines:

test("conversation pipeline completes with visible text", async () => {
  // Mock LLM
  mockGenerateText.mockImplementation(async () => ({
    text: "Hello, world!",
    // ...
  }));

  const task = buildTask("task-1");
  const pipeline = conversationPipeline(buildDeps());
  const runner = new PipelineRunner();
  const bus = new PipelineEventBus<PipelineEventMap>();

  const result = await runner.run(pipeline, task, bus);

  expect(result.type).toBe(PipelineResultType.Complete);
  expect(result.task.id).toBe("task-1");
});
```

## 8. HTTP API Testing

```typescript
test("POST /api/tasks creates and enqueues a task", async () => {
  const res = await fetch("http://localhost:3000/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "session-1",
      chatId: "chat-1",
      pipeline: "conversation",
      source: "external",
      data: { text: "Hello" },
    }),
  });

  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.taskId).toBeDefined();
  expect(body.state).toBe("waiting");
});
```

## 9. WebSocket Testing

```typescript
test("receives transport.delta events via WebSocket", async () => {
  const ws = new WebSocket("ws://localhost:3000/ws/session-1");

  const events: any[] = [];
  ws.onmessage = (msg) => events.push(JSON.parse(msg.data));

  // Submit a task
  ws.send(JSON.stringify({
    type: "task.submit",
    seq: 0,
    ts: Date.now(),
    payload: { sessionId: "session-1", chatId: "chat-1", pipeline: "conversation", source: "external", data: { text: "Test" } },
  }));

  // Wait for events
  await new Promise(r => setTimeout(r, 1000));

  expect(events.some(e => e.type === "task.created")).toBe(true);
  expect(events.some(e => e.type === "transport.delta")).toBe(true);

  ws.close();
});
```

## 10. Coverage Standards

| Component | Minimum Coverage |
|-----------|-----------------|
| Pipeline Elements | 100% (mode gate, processing, transition) |
| Pipeline Runner | 100% |
| Task Engine | 100% |
| Tool Registry | 100% |
| Session Store | 100% |
| Pipeline Builder | 100% |
| HTTP handlers | 90%+ (happy path + error cases) |
| Replay system | 100% |

## 相关文档

| 文档 | 说明 |
|------|------|
| [pipeline-dev.md](../core/pipeline-dev.md) | Element 测试模板和模式 |
| [coding.md](./coding.md) | 测试代码风格约束 |