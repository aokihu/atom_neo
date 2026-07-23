import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge, parseInline } from "./shared";

export default function ErrorHandlingPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ── Section 1: Error Propagation Chain ── */}
      <Section title="Error Propagation Chain">
        <div className="error-flow">
          <div className="error-flow__layer error-flow__layer--element">
            <div className="error-flow__label">Element.doProcess()</div>
            <div className="error-flow__desc">throws on failure</div>
          </div>
          <div className="error-flow__arrow">
            <span className="error-flow__arrow-icon">↓</span>
            <span className="error-flow__arrow-text">catches, emits "element.failed", rethrows</span>
          </div>
          <div className="error-flow__layer error-flow__layer--pipeline">
            <div className="error-flow__label">PipelineRunner.run()</div>
            <div className="error-flow__desc">catches, emits "pipeline.element.failed", rethrows</div>
          </div>
          <div className="error-flow__arrow">
            <span className="error-flow__arrow-icon">↓</span>
            <span className="error-flow__arrow-text">catches, emits "task.failed", updates taskQueue</span>
          </div>
          <div className="error-flow__layer error-flow__layer--engine">
            <div className="error-flow__label">TaskEngine</div>
            <div className="error-flow__desc">taskQueue.updateTask(FAILED)</div>
          </div>
          <div className="error-flow__arrow">
            <span className="error-flow__arrow-icon">↓</span>
            <span className="error-flow__arrow-text">formats error response</span>
          </div>
          <div className="error-flow__split">
            <div className="error-flow__layer error-flow__layer--http">
              <div className="error-flow__label">HTTP Handler</div>
              <div className="error-flow__desc">Response.json()</div>
            </div>
            <div className="error-flow__layer error-flow__layer--ws">
              <div className="error-flow__label">WS Handler</div>
              <div className="error-flow__desc">ws.send(json)</div>
            </div>
          </div>
          <div className="error-flow__arrow">
            <span className="error-flow__arrow-icon">↓</span>
            <span className="error-flow__arrow-text">delivered to</span>
          </div>
          <div className="error-flow__layer error-flow__layer--client">
            <div className="error-flow__label">Client</div>
            <div className="error-flow__desc">receives error response</div>
          </div>
        </div>
        <Callout type="info" title="Key Principle">
          Every layer has a defined error boundary. No error crosses a boundary unhandled.
        </Callout>
      </Section>

      <Section title="Provider 401 → TUI Error Modal">
        <Callout type="warn" title="Invalid API Keys are terminal and visible">
          When the model Provider returns HTTP 401, Conversation Finalize first releases the
          unaccepted Context Snapshot, then throws an error with <code>code=&quot;API_KEY_INVALID&quot;</code>.
          Core broadcasts a session-scoped <code>event.task.failed</code>; TUI correlates it by
          <code>rootTaskId</code> and opens an <code>API Key Invalid</code> Modal. The rejected
          credential is not retried automatically.
        </Callout>
        <CodeBlock lang="text" code={`Provider HTTP 401
  → release Context Snapshot
  → task.failed { code: "API_KEY_INVALID" }
  → TUI rejects the matching pending request
  → blocking API Key Invalid Modal`} />
      </Section>

      {/* ── Section 2: Layer 1 – Element Errors ── */}
      <Section title="Layer 1: Element Errors">
        <Callout type="info" title="Responsibility">
          Elements <strong>throw</strong> on expected failures (validation, missing data, runtime errors).
          Elements MUST NOT silently swallow errors.
        </Callout>
        <CodeBlock lang="typescript" code={`// Elements throw on EXPECTED failures (validation, missing data, runtime errors)
// Elements MUST NOT silently swallow errors

class MyElement extends BaseElement {
  async doProcess(input: FlowState): Promise<FlowState> {
    if (!input.requiredField) {
      throw new Error("requiredField is missing");  // Will be caught by BaseElement
    }

    // External call failure: throw
    const result = await this.#service.call();
    if (!result.ok) {
      throw new Error(\`Service call failed: \${result.error}\`);
    }

    return { ...input, mode: NextMode };
  }
}

// BaseElement handles:
// 1. Catches error
// 2. Sets state to FAILED
// 3. Emits "element.failed" event
// 4. Rethrows to PipelineRunner`} />
      </Section>

      {/* ── Section 3: Layer 2 – Pipeline Runner ── */}
      <Section title="Layer 2: Pipeline Runner">
        <Callout type="info" title="Responsibility">
          PipelineRunner catches element errors, emits <code>"pipeline.element.failed"</code> event,
          and <strong>rethrows</strong> to stop the pipeline immediately.
        </Callout>
        <CodeBlock lang="typescript" code={`class PipelineRunner {
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
}`} />
      </Section>

      {/* ── Section 4: Layer 3 – Task Engine ── */}
      <Section title="Layer 3: Task Engine">
        <Callout type="info" title="Responsibility">
          TaskEngine is the <strong>final catch-all</strong> in the pipeline execution chain.
          It catches pipeline errors, emits <code>"task.failed"</code>, and updates the task queue.
        </Callout>
        <CodeBlock lang="typescript" code={`class TaskEngine {
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
}`} />
      </Section>

      {/* ── Section 5: Layer 4a – HTTP Handler ── */}
      <Section title="Layer 4a: HTTP Handler">
        <Callout type="info" title="Responsibility">
          HTTP handler formats errors into standardized JSON responses with appropriate HTTP status codes.
          Zod validation errors → 400, unknown errors → 500.
        </Callout>
        <CodeBlock lang="typescript" code={`// POST /api/tasks — submit task (synchronous response)
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
}`} />
      </Section>

      {/* ── Section 6: Layer 4b – WebSocket Handler ── */}
      <Section title="Layer 4b: WebSocket Handler">
        <Callout type="warn" title="Key Difference">
          WS errors are <strong>pushed as events</strong>, not thrown.
          Unknown event types get an <code>"error"</code> response with the appropriate error code.
        </Callout>
        <CodeBlock lang="typescript" code={`// WS errors are pushed as events, not thrown
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
          payload: { code: "UNKNOWN_EVENT_TYPE", message: \`Unknown type: \${parsed.type}\` },
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
}`} />
      </Section>

      {/* ── Section 7: Error Types ── */}
      <Section title="Error Types">
        <CodeBlock lang="typescript" code={`// src/src/packages/shared/src/types/error.ts

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
      ...(process.env.NODE_ENV === "development" ? { stack: error.stack } : {}),
    };
  }

  return {
    error: "UNKNOWN_ERROR",
    message: String(error),
  };
}`} />

        <h3 style={{ marginTop: "2rem" }}>Pipeline Error Codes</h3>
        <ComparisonTable
          headers={["Error Code", "Category", "Description"]}
          rows={[
            [<code>PIPELINE_ABORTED</code>, <Badge color="orange">Pipeline</Badge>, "Pipeline was cancelled via AbortSignal"],
            [<code>ELEMENT_FAILED</code>, <Badge color="orange">Element</Badge>, "An element threw an unhandled error during processing"],
            [<code>ELEMENT_MODE_MISMATCH</code>, <Badge color="orange">Element</Badge>, "Element returned an unexpected NextMode value"],
          ]}
        />

        <h3 style={{ marginTop: "2rem" }}>API Error Codes</h3>
        <ComparisonTable
          headers={["Error Code", "Category", "Description"]}
          rows={[
            [<code>INVALID_PAYLOAD</code>, <Badge color="red">HTTP 400</Badge>, "Request body failed Zod schema validation"],
            [<code>TASK_NOT_FOUND</code>, <Badge color="orange">HTTP 404</Badge>, "Requested task ID does not exist"],
            [<code>PIPELINE_NOT_FOUND</code>, <Badge color="orange">HTTP 404</Badge>, "Requested pipeline name is not registered"],
            [<code>INTERNAL_ERROR</code>, <Badge color="red">HTTP 500</Badge>, "Unhandled server-side exception"],
            [<code>RATE_LIMIT_EXCEEDED</code>, <Badge color="orange">HTTP 429</Badge>, "Client exceeded rate limit threshold"],
            [<code>SESSION_NOT_FOUND</code>, <Badge color="orange">HTTP 404</Badge>, "Requested session ID does not exist"],
          ]}
        />

        <h3 style={{ marginTop: "2rem" }}>WebSocket Error Codes</h3>
        <ComparisonTable
          headers={["Error Code", "Category", "Description"]}
          rows={[
            [<code>INVALID_MESSAGE</code>, <Badge color="purple">WS</Badge>, "Message could not be parsed as valid JSON"],
            [<code>UNKNOWN_EVENT_TYPE</code>, <Badge color="purple">WS</Badge>, "Message type field does not match any known event"],
            [<code>AUTH_FAILED</code>, <Badge color="purple">WS</Badge>, "WebSocket authentication token is invalid or expired"],
          ]}
        />
      </Section>

      {/* ── Section 8: Error Flow Diagram ── */}
      <Section title="Error Flow Diagram">
        <div className="error-diagram">
          <div className="error-diagram__node error-diagram__node--element">
            <div className="error-diagram__label">Element</div>
            <div className="error-diagram__desc">throws</div>
          </div>
          <div className="error-diagram__arrow error-diagram__arrow--element">
            <span className="error-diagram__arrow-text">catches + emits "element.failed"</span>
          </div>
          <div className="error-diagram__node error-diagram__node--pipeline">
            <div className="error-diagram__label">BaseElement.process()</div>
          </div>
          <div className="error-diagram__arrow error-diagram__arrow--pipeline">
            <span className="error-diagram__arrow-text">rethrows + emits "pipeline.element.failed"</span>
          </div>
          <div className="error-diagram__node error-diagram__node--engine">
            <div className="error-diagram__label">PipelineRunner.run()</div>
          </div>
          <div className="error-diagram__arrow error-diagram__arrow--engine">
            <span className="error-diagram__arrow-text">emits "task.failed" · taskQueue.updateTask(FAILED)</span>
          </div>
          <div className="error-diagram__node error-diagram__node--engine">
            <div className="error-diagram__label">TaskEngine.#runTask()</div>
          </div>
          <div className="error-diagram__branch">
            <div className="error-diagram__branch-arm error-diagram__branch-arm--left">
              <div className="error-diagram__arrow">
                <span className="error-diagram__arrow-text">Response.json({"{}"})</span>
              </div>
              <div className="error-diagram__node error-diagram__node--http">
                <div className="error-diagram__label">HTTP Handler</div>
                <div className="error-diagram__desc">{"{ error: \"...\", message: \"...\" }"}</div>
              </div>
            </div>
            <div className="error-diagram__branch-arm error-diagram__branch-arm--right">
              <div className="error-diagram__arrow">
                <span className="error-diagram__arrow-text">ws.send(json)</span>
              </div>
              <div className="error-diagram__node error-diagram__node--ws">
                <div className="error-diagram__label">WS Handler</div>
                <div className="error-diagram__desc">{"{ type: \"task.failed\", payload: {...} }"}</div>
              </div>
            </div>
          </div>
          <div className="error-diagram__merge">
            <div className="error-diagram__arrow">
              <span className="error-diagram__arrow-text">delivered to</span>
            </div>
            <div className="error-diagram__node error-diagram__node--client">
              <div className="error-diagram__label">Client</div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Section 9: When to Throw vs Return Error ── */}
      <Section title="When to Throw vs Return Error">
        <div className="cmp" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <Callout type="warn" title="THROW">
              <ul>
                <li>Element processing fails and cannot continue</li>
                <li>Invalid state (should never happen)</li>
                <li>External service call fails (memory, tool)</li>
                <li>Config validation fails at startup</li>
              </ul>
            </Callout>
          </div>
          <div>
            <Callout type="ok" title={'RETURN { ok: false, error }'}>
              <ul>
                <li>Tool execution fails (tool returns error to LLM)</li>
                <li>Validation of user input fails</li>
                <li>Optional operations (cleanup, logging)</li>
              </ul>
            </Callout>
          </div>
        </div>
      </Section>

      {/* ── Section 10: Development Mode Error Details ── */}
      <Section title="Development Mode Error Details">
        <Callout type="tip" title="Dev vs Prod">
          In development mode (<code>NODE_ENV !== "production"</code>), error responses include
          <strong> stack traces</strong> and <strong>cause chains</strong> for easier debugging.
          In production, these are stripped for security.
        </Callout>
        <CodeBlock lang="typescript" code={`// In development, include stack traces and extra detail:
const isDevelopment = process.env.NODE_ENV !== "production";

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
}`} />
      </Section>
    </div>
  );
}
