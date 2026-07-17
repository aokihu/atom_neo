import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge, slugify } from "./shared";

const examples = {
  envelope: `type WSMessage<T extends string, P = Record<string, unknown>> = {
  type: T;
  seq: number;       // Sender-assigned sequence number
  ts: number;        // Unix timestamp in milliseconds
  payload: P;
};`,
  sessionPath: `const encodedSessionId = encodeURIComponent(sessionId);
const ws = new WebSocket(\`\${coreUrl}/ws/\${encodedSessionId}\`);`,
  taskSubmit: `{
  type: "event.task.submit",
  seq: 0,
  ts: 1700000000000,
  payload: {
    sessionId: string;
    chatId: string;
    pipeline: string;
    source: TaskSource;
    data: {
      text?: string;
      toolReport?: TaskToolReport;
    };
  };
}`,
  taskCancel: `{
  type: "event.task.cancel",
  seq: 0,
  ts: 1700000000000,
  payload: { taskId: string };
}`,
  ping: `{
  type: "ping",
  seq: 0,
  ts: 1700000000000,
  payload: {};
}`,
  taskCreated: `{
  type: "event.task.created",
  seq: 1,
  ts: 1700000000001,
  payload: {
    taskId: string;
    state: "waiting" | "pending" | "processing";
  };
}`,
  taskStateChanged: `{
  type: "event.task.state-changed",
  seq: 2,
  ts: 1700000000002,
  payload: {
    taskId: string;
    previousState: string;
    currentState: "waiting" | "pending" | "processing" | "completed" | "failed" | "cancelled";
  };
}`,
  elementStarted: `{
  type: "event.pipeline.element.started",
  seq: 3,
  ts: 1700000000003,
  payload: {
    taskId: string;
    elementName: string;
    elementKind: "source" | "transform" | "boundary" | "sink";
  };
}`,
  elementFinished: `{
  type: "event.pipeline.element.finished",
  seq: 4,
  ts: 1700000000004,
  payload: {
    taskId: string;
    elementName: string;
    elementKind: string;
    durationMs: number;
  };
}`,
  transportDelta: `{
  type: "event.transport.delta",
  seq: 5,
  ts: 1700000000005,
  payload: {
    sessionId: string;
    taskId: string;
    textDelta: string;
    offset: number;
  };
}`,
  deltaAssembly: `// Position-aware assembly; do not blindly append.
content = content.substring(0, offset) + textDelta;`,
  toolStarted: `{
  type: "event.transport.tool.started",
  seq: 6,
  ts: 1700000000006,
  payload: {
    sessionId: string;
    taskId: string;
    toolName: string;
    toolCallId: string;
    input: unknown;
  };
}`,
  toolFinished: `{
  type: "event.transport.tool.finished",
  seq: 7,
  ts: 1700000000007,
  payload: {
    sessionId: string;
    taskId: string;
    toolName: string;
    toolCallId: string;
    result?: unknown;
    error?: unknown;
  };
}`,
  taskCompleted: `{
  type: "event.task.completed",
  seq: 8,
  ts: 1700000000008,
  payload: {
    taskId: string;
    rootTaskId: string;
    parentTaskId: string | null;
    terminal: boolean;
    output: string;
    reasoningContent: string;
    tokenUsage: { total: number };
  };
}`,
  taskFailed: `{
  type: "event.task.failed",
  seq: 9,
  ts: 1700000000009,
  payload: {
    taskId: string;
    rootTaskId: string;  // Task chainId: external root, or this task when independent
    code?: string;       // PIPELINE_ABORTED when cancelled by the user
    error: string;
  };
}`,
  pong: `{
  type: "pong",
  seq: 10,
  ts: 1700000000010,
  payload: {};
}`,
  replayStart: `{
  type: "event.pipeline.replay-start",
  seq: 0,
  ts: 1700000000000,
  payload: {
    sessionId: string;
    taskId: string;
  };
}`,
  replayEvent: `{
  type: "replay.event",
  seq: 1,
  ts: 1700000000001,
  payload: {
    taskId: string;
    event: WSServerEvent;
  };
}`,
  replayEnd: `{
  type: "event.pipeline.replay-end",
  seq: 999,
  ts: 1700000000100,
  payload: {
    sessionId: string;
    taskId: string;
    totalEvents: number;
  };
}`,
  eventRegistry: `export const ClientEventTypes = [
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
] as const;`,
  gatewayApiAuth: `POST /api/tasks
Authorization: Bearer eyJhbG...

// JWT payload
{
  sub: "user-id",
  permissionLevel: 0 | 1 | 2,
  exp: 1700000000,
  iat: 1699996400,
}`,
  gatewayClientAuth: `POST /gateway/status
Authorization: Bearer 550e8400-e29b-41d4-a716-446655440000`,
  errorCodes: `"PIPELINE_ABORTED"          // Signal cancelled
"ELEMENT_FAILED"            // Element threw an error
"TOOL_PERMISSION_DENIED"    // Tool level exceeds permission
"RATE_LIMIT_EXCEEDED"       // Gateway rate limit hit
"SESSION_NOT_FOUND"         // Invalid session ID
"INVALID_PAYLOAD"           // Message fails validation`,
} as const;

export default function DocPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader
        title={title}
        description={description}
        category={category}
        readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))}
      />

      {/* ── Event Type Catalog ── */}
      <Section title="Event Type Catalog">
        <ComparisonTable
          headers={["Direction", "Event Type", "Description"]}
          rows={[
            [<Badge color="blue">Client→Core</Badge>, <code>task.submit</code>, "Submit a new pipeline task"],
            [<Badge color="blue">Client→Core</Badge>, <code>task.cancel</code>, "Cancel a running task"],
            [<Badge color="blue">Client→Core</Badge>, <code>ping</code>, "Keep-alive heartbeat"],
            [<Badge color="green">Core→Client</Badge>, <code>task.created</code>, "Task has been created in the engine"],
            [<Badge color="green">Core→Client</Badge>, <code>task.state-changed</code>, "Task state transition occurred"],
            [<Badge color="green">Core→Client</Badge>, <code>pipeline.element.started</code>, "Pipeline element began execution"],
            [<Badge color="green">Core→Client</Badge>, <code>pipeline.element.finished</code>, "Pipeline element completed execution"],
            [<Badge color="green">Core→Client</Badge>, <code>transport.delta</code>, "Incremental text response from LLM"],
            [<Badge color="green">Core→Client</Badge>, <code>transport.tool.started</code>, "Tool invocation started"],
            [<Badge color="green">Core→Client</Badge>, <code>transport.tool.finished</code>, "Tool invocation completed"],
            [<Badge color="green">Core→Client</Badge>, <code>task.completed</code>, "Task finished successfully"],
            [<Badge color="green">Core→Client</Badge>, <code>task.failed</code>, "Task terminated with error"],
            [<Badge color="green">Core→Client</Badge>, <code>pong</code>, "Keep-alive response"],
            [<Badge color="purple">Replay</Badge>, <code>replay.start</code>, "Begin pipeline event replay"],
            [<Badge color="purple">Replay</Badge>, <code>replay.event</code>, "Single recorded event replayed"],
            [<Badge color="purple">Replay</Badge>, <code>replay.end</code>, "Replay session complete"],
          ]}
        />
      </Section>

      {/* ── Section 1: Transport ── */}
      <Section id="transport" title="Transport">
        <Callout type="info" title="Transport Rules">
          <ul>
            <li><strong>Core Side</strong>: WebSocket server at <code>ws://host:port/ws/:sessionId</code></li>
            <li><strong>Gateway Side</strong>: Handles authenticated HTTP APIs only; does not proxy WebSocket</li>
            <li><strong>TUI Side</strong>: Direct WebSocket connection to Core (localhost, no auth)</li>
            <li><strong>Message Format</strong>: JSON, one message per frame</li>
            <li>
              <strong>Session Routing</strong>: Task-scoped <code>event.transport.*</code> events
              carry <code>sessionId</code> and <code>taskId</code>, and are only sent to clients
              connected through the matching <code>/ws/:sessionId</code> endpoint. System-level
              events such as MCP status remain global.
            </li>
            <li>
              <strong>Session Path Encoding</strong>: Clients encode <code>sessionId</code> with
              <code>encodeURIComponent()</code> before placing it in <code>/ws/:sessionId</code> or
              <code>/api/sessions/:sessionId</code>. Core decodes the single path segment exactly
              once. Empty IDs, malformed escapes, and unencoded extra segments return <code>400</code>.
            </li>
          </ul>
        </Callout>
        <CodeBlock lang="typescript" code={examples.sessionPath} />
      </Section>

      {/* ── Section 2: Common Envelope ── */}
      <Section id="common-envelope" title="Common Envelope">
        <p>All messages follow a standard envelope with sequence number and timestamp.</p>
        <CodeBlock lang="typescript" code={examples.envelope} />
        <Callout type="info" title="Core outbound sequence">
          Client messages use a client-assigned sequence. Every Core outbound message uses one
          process-wide, strictly increasing sequence allocated by the WebSocket Broadcaster.
          A broadcast allocates one value shared by all recipients. Session clients may observe
          gaps caused by messages routed to other Sessions, so sequence values are ordered but
          not necessarily contiguous for an individual client.
        </Callout>
      </Section>

      {/* ── Section 3: Client → Core Events ── */}
      <Section id="client-to-core" title="Client → Core Events">
        <p>Events sent by the client to request task processing or maintain the connection.</p>

        <h3 id={slugify("3.1 task.submit")}>3.1 task.submit</h3>
        <p>Submit a new pipeline task for execution. The <code>data</code> field carries pipeline-specific input.</p>
        <CodeBlock lang="typescript" code={examples.taskSubmit} />

        <h3 id={slugify("3.2 task.cancel")}>3.2 task.cancel</h3>
        <p>
          Request cancellation of a queued or running task. Core derives the Session from the
          current <code>/ws/:sessionId</code> connection and only cancels a matching Task.
          The matching Task resolves its <code>chainId</code>: every queued member is removed,
          every running member receives an AbortSignal, and staged descendants are discarded.
          Cancellation is a highest-priority control operation and cancelled member Tasks enter
          the <code>cancelled</code> state.
        </p>
        <CodeBlock lang="typescript" code={examples.taskCancel} />
        <Callout type="info" title="Cancellation boundary is the Task Chain">
          Prediction, Conversation, follow-up, context-compress, and post-conversation are
          cancelled together when they share the resolved <code>chainId</code>. Independent Tasks
          use their own ID as the chain ID.
        </Callout>
        <Callout type="warn" title="Session ownership is mandatory">
          The payload only identifies <code>taskId</code>. Core must not trust a client-provided
          Session ID or reveal whether the same Task ID exists in another Session.
        </Callout>

        <h3 id={slugify("3.3 ping")}>3.3 ping</h3>
        <p>Keep-alive heartbeat sent periodically by the client.</p>
        <CodeBlock lang="typescript" code={examples.ping} />
      </Section>

      {/* ── Section 4: Core → Client Events ── */}
      <Section id="core-to-client" title="Core → Client Events">
        <p>
          Events broadcast by Core to all connected clients for a given session.
          These represent the full lifecycle of a task from creation to completion.
        </p>

        <h3 id={slugify("4.1 task.created")}>4.1 task.created</h3>
        <p>Emitted when a task is created and enters the engine queue.</p>
        <CodeBlock lang="typescript" code={examples.taskCreated} />

        <h3 id={slugify("4.2 task.state-changed")}>4.2 task.state-changed</h3>
        <p>
          Emitted whenever the task transitions between states.
          Possible states: <code>waiting</code>, <code>pending</code>, <code>processing</code>,
          <code>completed</code>, <code>failed</code>, <code>cancelled</code>, <code>follow_up</code>,
          <code>dispatched</code>, <code>suspended</code>.
        </p>
        <CodeBlock lang="typescript" code={examples.taskStateChanged} />

        <h3 id={slugify("4.3 pipeline.element.started")}>4.3 pipeline.element.started</h3>
        <p>Emitted when a pipeline element begins execution. The <code>elementKind</code> identifies the element role.</p>
        <CodeBlock lang="typescript" code={examples.elementStarted} />

        <h3 id={slugify("4.4 pipeline.element.finished")}>4.4 pipeline.element.finished</h3>
        <p>Emitted when a pipeline element completes, including execution duration.</p>
        <CodeBlock lang="typescript" code={examples.elementFinished} />

        <h3 id={slugify("4.5 transport.delta")}>4.5 transport.delta</h3>
        <p>Streaming incremental text sent from the LLM during response generation.</p>
        <CodeBlock lang="typescript" code={examples.transportDelta} />
        <CodeBlock lang="typescript" code={examples.deltaAssembly} />

        <h3 id={slugify("4.6 transport.tool.started")}>4.6 transport.tool.started</h3>
        <p>Emitted when a tool invocation begins. Includes the tool identity and input.</p>
        <CodeBlock lang="typescript" code={examples.toolStarted} />

        <h3 id={slugify("4.7 transport.tool.finished")}>4.7 transport.tool.finished</h3>
        <p>
          Emitted when a tool invocation completes. Successful calls carry <code>result</code>;
          failed calls carry <code>error</code>.
        </p>
        <CodeBlock lang="typescript" code={examples.toolFinished} />
        <Callout type="info" title="Result and error are the wire contract">
          Tool source, duration, and the internal <code>ok</code> flag remain Core observability
          data. They are not duplicated in the per-call WebSocket event. Builtin and MCP tools use
          the same <code>result</code>/<code>error</code> completion semantics.
        </Callout>
        <Callout type="info" title="Session-scoped transport events">
          <code>event.transport.reason</code>, <code>event.transport.tool.step-finished</code> and{" "}
          <code>event.transport.tool.group-complete</code> follow the same ownership contract:
          their payloads include the producing <code>sessionId</code> and <code>taskId</code>, and
          Core only sends them to that Session&apos;s WebSocket clients.
        </Callout>

        <h3 id={slugify("4.8 task.completed")}>4.8 task.completed</h3>
        <p>
          Emitted when one Task finishes successfully. <code>rootTaskId</code> identifies the
          original request, while <code>terminal</code> states whether that entire request has
          reached a successful terminal state.
        </p>
        <CodeBlock lang="typescript" code={examples.taskCompleted} />
        <ComparisonTable
          headers={["After the current Task commits", "terminal", "Client action"]}
          rows={[
            ["A downstream Task was released", <code>false</code>, "Keep waiting for the same rootTaskId"],
            ["No downstream Task remains", <code>true</code>, "Resolve the matching pending request"],
          ]}
        />
        <Callout type="warn" title="Do not infer request completion from Task hierarchy">
          Clients must not treat the first child Task or a matching <code>parentTaskId</code> as
          request completion. Only <code>rootTaskId</code> plus <code>terminal=true</code> closes a
          successful pending request.
        </Callout>

        <h3 id={slugify("4.9 task.failed")}>4.9 task.failed</h3>
        <p>
          Emitted when a task terminates with an error. Failure is terminal: the
          <code>rootTaskId</code> binds it to the original request, and clients must ignore failures
          that do not match a pending request.
        </p>
        <CodeBlock lang="typescript" code={examples.taskFailed} />

        <h3 id={slugify("4.10 pong")}>4.10 pong</h3>
        <p>Response to the client <code>ping</code> event.</p>
        <CodeBlock lang="typescript" code={examples.pong} />
      </Section>

      {/* ── Section 5: Pipeline Replay Events ── */}
      <Section id="pipeline-replay" title="Pipeline Replay Events">
        <p>
          <Badge color="purple">Replay</Badge>{" "}
          Replay events allow clients to replay a previously recorded task pipeline
          for debugging and observability purposes.
        </p>
        <Callout type="tip" title="Use Case">
          Pipeline replay is the primary mechanism for reproducing issues. Record a run,
          then replay it with different configurations or inspect element-by-element timing.
        </Callout>

        <h3 id={slugify("5.1 replay.start")}>5.1 replay.start</h3>
        <p>Signals the start of a pipeline replay session for a specific task.</p>
        <CodeBlock lang="typescript" code={examples.replayStart} />

        <h3 id={slugify("5.2 replay.event")}>5.2 replay.event</h3>
        <p>Emitted for each recorded event during replay. The <code>event</code> field wraps any server event.</p>
        <CodeBlock lang="typescript" code={examples.replayEvent} />

        <h3 id={slugify("5.3 replay.end")}>5.3 replay.end</h3>
        <p>Signals the end of a replay session with the total event count.</p>
        <CodeBlock lang="typescript" code={examples.replayEnd} />
      </Section>

      {/* ── Section 6: Event Type Registry ── */}
      <Section id="event-type-registry" title="Event Type Registry">
        <Callout type="warn" title="Do Not Edit Manually">
          This registry is the source of truth for all event type strings. The TypeScript
          <code>as const</code> assertion ensures type-safety across the entire codebase.
        </Callout>
        <CodeBlock lang="typescript" code={examples.eventRegistry} />
      </Section>

      {/* ── Section 7: Gateway Authentication ── */}
      <Section id="gateway-auth" title="Gateway Authentication">
        <p>
          Gateway only proxies HTTP requests. External <code>/api/*</code> calls use JWT Bearer
          authentication; internal <code>/gateway/*</code> calls use an in-memory Client Token.
        </p>
        <h3 id={slugify("7.1 api JWT")}>7.1 /api/* — JWT Bearer Token</h3>
        <CodeBlock lang="text" code={examples.gatewayApiAuth} />
        <h3 id={slugify("7.2 gateway Client Token")}>7.2 /gateway/* — Client Token</h3>
        <CodeBlock lang="text" code={examples.gatewayClientAuth} />
        <Callout type="info" title="WebSocket 直连 Core">
          Gateway 不代理 WebSocket，也不执行 JWT upgrade。TUI 直接连接 Core 的
          <code>/ws/:sessionId</code> 端点。
        </Callout>
      </Section>

      {/* ── Section 8: Error Event Details ── */}
      <Section id="error-events" title="Error Event Details">
        <p>Standardized error codes returned in <code>task.failed</code> payloads.</p>
        <ComparisonTable
          headers={["Error Code", "Meaning"]}
          rows={[
            [<code>PIPELINE_ABORTED</code>, "Task cancelled via signal"],
            [<code>ELEMENT_FAILED</code>, "Pipeline element threw an unhandled error"],
            [<code>TOOL_PERMISSION_DENIED</code>, "Required tool level exceeds user permission"],
            [<code>RATE_LIMIT_EXCEEDED</code>, "Gateway rate limit triggered"],
            [<code>SESSION_NOT_FOUND</code>, "Invalid or expired session ID"],
            [<code>INVALID_PAYLOAD</code>, "Message failed schema validation"],
          ]}
        />
        <CodeBlock lang="text" code={examples.errorCodes} />
      </Section>
    </div>
  );
}
