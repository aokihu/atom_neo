# Error Handling Model

> **Purpose**: How errors propagate across layers: Element → Pipeline → Task Engine → HTTP/WS → Client.
> Every layer has a defined error boundary. No error crosses a boundary unhandled.

---

## 1. Error Propagation Chain

```text
Element.doProcess()  ──throws──→  BaseElement.process()  ──catches, emits "element.failed", rethrows──→
  PipelineRunner.run()  ──catches, emits "pipeline.element.failed", rethrows──→
    TaskEngine  ──catches, emits "task.failed", calls taskQueue.updateTask(FAILED)──→
      HTTP handler / WS handler  ──formats error response──→
        Client
```

---

## 2. Layer 1: Element Errors

```typescript
// Elements throw on EXPECTED failures (validation, missing data, runtime errors)
// Elements MUST NOT silently swallow errors

class MyElement extends BaseElement {
  async doProcess(input: FlowState): Promise<FlowState> {
    if (!input.requiredField) {
      throw new Error("requiredField is missing");  // Will be caught by BaseElement
    }

    // External call failure: throw
    const result = await this.#service.call();
    if (!result.ok) {
      throw new Error(`Service call failed: ${result.error}`);
    }

    return { ...input, mode: NextMode };
  }
}

// BaseElement handles:
// 1. Catches error
// 2. Sets state to FAILED
// 3. Emits "element.failed" event
// 4. Rethrows to PipelineRunner
```

---

## 3. Layer 2: Pipeline Runner

```typescript
class PipelineRunner {
  async run<I, O>(pipeline: Pipeline<I, O>, input: I, bus: PipelineEventBus, signal?: AbortSignal): Promise<O> {
    let current = input;

    for (const element of pipeline.elements) {
      if (signal?.aborted) {
        throw new PipelineError("PIPELINE_ABORTED", "Pipeline was cancelled");
      }

      try {
        current = await element.process(current);
        bus.emit("pipeline.element.finished", { name: element.name, /* ... */ });
      } catch (error) {
        bus.emit("pipeline.element.failed", {
          pipelineName: pipeline.name,
          elementName: element.name,
          elementKind: element.kind,
          durationMs: performance.now() - startedAt,
          error,
        });
        throw error;  // Rethrow to stop pipeline
      }
    }

    return current as O;
  }
}
```

---

## 4. Layer 3: Task Engine

```typescript
class TaskEngine {
  async #runTask(task: TaskItem): Promise<void> {
    try {
      const pipeline = this.#pipelineManager.get(task.pipeline);
      const input = pipeline.createInput(task);
      const result = await this.#runner.run(pipeline, input, this.#bus, task.signal);

      this.#bus.emit("task.completed", { task, result });
      this.#taskQueue.updateTask(task.id, { state: TaskState.COMPLETED });

    } catch (error) {
      this.#bus.emit("task.failed", { task, error });
      this.#taskQueue.updateTask(task.id, {
        state: TaskState.FAILED,
        error: normalizeError(error),
      });
    }
  }
}
```

---

## 4.5. Token Overflow Recovery

当 LLM 调用因上下文过大返回空结果时，`stream-llm` 检测到 `stepCount===0 && fullTextLen===0 && ratio > 0.8`，标记 `tokenOverflow: true`。

`finalize` 收到该标记后计算动态压缩比并通过 `orchestrator.scheduleCompress()` 触发上下文压缩：

```typescript
compressRatio = max(0, (tokenUsage / effectiveLimit - 0.8) * 5);
session.compressing = true;  // 单锁防重复
```

压缩管线使用 5 档策略表（ratio → keepCount/maxSummaryTokens），优先使用独立的 `basic` profile 模型（成本更低，无 thinking 参数兼容性问题）。压缩失败时 `compressRatio` 自动升级（+0.4），逐步加大压缩力度。压缩完成后 conversation task 重新执行，拿到压缩后的上下文。

```
stream-llm → overflow detected (ratio > 0.8)
  → finalize → 计算 compressRatio → scheduleCompress
    → context-compress pipeline (basic model)
    → conversation retry (压缩后的 session)
```

**ratio 门控防误判**：ratio ≤ 0.8 时（如零输出由 400 错误导致）不触发压缩，报 `stream-error-not-overflow`，避免正常 token 使用被误判为溢出。

---

## 5. Layer 4a: HTTP Handler

```typescript
// POST /api/tasks — submit task (synchronous response)
async function handlePostTasks(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const payload = TaskSubmitSchema.parse(body);
    const task = taskFactory.create(payload);

    taskQueue.enqueue(task);

    return Response.json({ taskId: task.id, state: task.state }, { status: 201 });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({
        error: "INVALID_PAYLOAD",
        message: "Request body validation failed",
        details: error.issues,
      }, { status: 400 });
    }

    return Response.json({
      error: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
```

---

## 6. Layer 4b: WebSocket Handler

```typescript
// WS errors are pushed as events, not thrown
function handleWsMessage(ws: WebSocket, msg: string, ctx: AppContext): void {
  try {
    const parsed = JSON.parse(msg);

    switch (parsed.type) {
      case "task.submit": {
        const task = taskFactory.create(parsed.payload);
        ctx.taskQueue.enqueue(task);
        ws.send(JSON.stringify({
          type: "task.created",
          seq: ++ctx.seq,
          ts: Date.now(),
          payload: { taskId: task.id, state: task.state },
        }));
        break;
      }
      default:
        ws.send(JSON.stringify({
          type: "error",
          seq: ++ctx.seq,
          ts: Date.now(),
          payload: { code: "UNKNOWN_EVENT_TYPE", message: `Unknown type: ${parsed.type}` },
        }));
    }
  } catch (error) {
    ws.send(JSON.stringify({
      type: "error",
      seq: ++ctx.seq,
      ts: Date.now(),
      payload: {
        code: "INVALID_MESSAGE",
        message: error instanceof Error ? error.message : "Failed to process message",
      },
    }));
  }
}
```

---

## 7. Error Types

```typescript
// src/packages/shared/src/types/error.ts

export type PipelineErrorCode =
  | "PIPELINE_ABORTED"
  | "ELEMENT_FAILED"
  | "ELEMENT_MODE_MISMATCH";

export type APIErrorCode =
  | "INVALID_PAYLOAD"
  | "TASK_NOT_FOUND"
  | "PIPELINE_NOT_FOUND"
  | "INTERNAL_ERROR"
  | "RATE_LIMIT_EXCEEDED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "SESSION_NOT_FOUND";

export type WSErrorCode =
  | "INVALID_MESSAGE"
  | "UNKNOWN_EVENT_TYPE"
  | "AUTH_FAILED";

// Standardized error response:
export type ErrorResponse = {
  error: string;           // Error code for machines
  message: string;         // Human-readable message
  details?: unknown;       // Optional structured details
  stack?: string;          // Only in development
};

// Error normalization:
export function normalizeError(error: unknown): ErrorResponse {
  if (error instanceof AggregateError) {
    return {
      error: "AGGREGATE_ERROR",
      message: error.message,
      details: error.errors.map(normalizeError),
    };
  }

  if (error instanceof Error) {
    return {
      error: error.name || "ERROR",
      message: error.message,
      ...(Bun.env.NODE_ENV === "development" ? { stack: error.stack } : {}),
    };
  }

  return {
    error: "UNKNOWN_ERROR",
    message: String(error),
  };
}
```

---

## 8. Error Flow Diagram

```text
                    Element throws
                         │
                    ┌────▼────┐
                    │BaseElement│
                    │ .process()│
                    └────┬────┘
                         │ rethrows + emits "element.failed"
                    ┌────▼────┐
                    │PipelineRunner│
                    │ .run()       │
                    └────┬─────────┘
                         │ rethrows + emits "pipeline.element.failed"
                    ┌────▼────┐
                    │TaskEngine │
                    │#runTask() │
                    └────┬─────┘
                         │ emits "task.failed"
                         │ taskQueue.updateTask(FAILED)
                         │
               ┌─────────┴─────────┐
               │                   │
          HTTP Handler        WS Handler
               │                   │
         Response.json()    ws.send(json)
          {error: ...}     {type:"task.failed"}
               │                   │
               └─────────┬─────────┘
                         │
                      Client
```

---

## 9. When to Throw vs Return Error

```text
THROW when:
  - Element processing fails and cannot continue
  - Invalid state (should never happen)
  - External service call fails (memory, tool)
  - Config validation fails at startup

RETURN { ok: false, error } when:
  - Tool execution fails (tool returns error to LLM)
  - Validation of user input fails
  - Optional operations (cleanup, logging)
```

---

## 10. Development Mode Error Details

```typescript
// In development, include stack traces and extra detail:
const isDevelopment = Bun.env.NODE_ENV !== "production";

function errorResponse(code: APIErrorCode, error: unknown): Response {
  const body: any = { error: code, message: String(error) };

  if (isDevelopment && error instanceof Error) {
    body.stack = error.stack;
    body.cause = error.cause;
  }

  return Response.json(body, {
    status: errorCodeToHttpStatus(code),
  });
}

function errorCodeToHttpStatus(code: APIErrorCode): number {
  switch (code) {
    case "INVALID_PAYLOAD": return 400;
    case "UNAUTHORIZED": return 401;
    case "FORBIDDEN": return 403;
    case "TASK_NOT_FOUND":
    case "PIPELINE_NOT_FOUND":
    case "SESSION_NOT_FOUND": return 404;
    case "RATE_LIMIT_EXCEEDED": return 429;
    default: return 500;
  }
}
```

## 11. Structured Diagnostic Logging

### BusEvents.Element.Data

所有 Element 通过 `this.report(BusEvents.Element.Data, payload)` 发射结构化诊断数据，统一日志格式 `{ step: string, ... }` 。不经过异常层，直接写入 debug 日志。

### 关键 step 值

| step 值 | 发射位置 | 关键字段 |
|---------|---------|---------|
| `starting LLM call` | stream-llm | `model`, `msgCount`, `toolCount`, `activeCount`, `taskIntent` |
| `stream-llm-error` | stream-llm (error chunk) | `errorName`, `statusCode`, `message`(500 chars), `responseBody`(500 chars) |
| `stream-error-not-overflow` | stream-llm | `ratio`, `tu`, `effectiveLimit` |
| `token-overflow-detected` | stream-llm | `ratio`, `tu`, `effectiveLimit`, `msgCount`, `taskIntent` |
| `done` | stream-llm | `outputLen`, `tokens`, `hasIntents`, `finishReason`, `stepCount` |
| `token-ratio` | TokenRatioElement (shared) | `tu`, `effectiveLimit`, `ratio` |
| `complete` | finalize | `chainAction` |
| `skip post-check, non-recoverable error` | finalize | `errorStatusCode` |
| `token-overflow, scheduling compress` | finalize | `compressRetry`, `compressRatio`, `tu`, `effectiveLimit` |
| `error, fallback` (predict/analyze) | predict-intent, post-analyze | `errorName`, `statusCode`, `responseBody`(200 chars) |
| `generated` (compress) | compress-summarize | `summaryLen` |
| `error` (compress) | compress-summarize | `errorName`, `statusCode`, `responseBody`(300 chars) |
| `conversation chain: post_check_retry depth exceeded` | server.ts | `depth`, `maxChainDepth` |
| `conversation chain: all todos completed` | server.ts | `todoCount` |

### 日志格式约定

- 错误类 step 携带 `errorName` / `statusCode` / `message`(≤500 char) / `responseBody`(≤500 char) — 不截断原始 JSON
- 状态类 step 携带 `tu`(tokenUsage) / `effectiveLimit` / `ratio`
- 控制类 step 携带 `chainAction` / `chainDepth` / `compressRetry`
- 所有 step 按 `{step, ...fields}` 格式输出到 FileSink（路径 `/tmp/atom-log-{timestamp}.log`）

## 相关文档

| 文档 | 说明 |
|------|------|
| [protocol.md](./protocol.md) | WebSocket 错误码定义 |
| [coding.md](../standards/coding.md#part-3-type-system) | 错误类型 SystemErrorCode / UserErrorCode |
| [testing.md](../standards/testing.md) | 错误路径测试规范 |
