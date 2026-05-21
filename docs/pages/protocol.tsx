import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge, slugify } from "./shared";

function extractCodeBlocks(content: string): string[] {
  const blocks: string[] = [];
  const re = /```typescript\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

export default function DocPage({ content, title, description, category }: DocPageProps) {
  const blocks = extractCodeBlocks(content);

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
            <li><strong>Gateway Side</strong>: Proxies WebSocket connections, verifies JWT in initial handshake</li>
            <li><strong>TUI Side</strong>: Direct WebSocket connection to Core (localhost, no auth)</li>
            <li><strong>Message Format</strong>: JSON, one message per frame</li>
          </ul>
        </Callout>
      </Section>

      {/* ── Section 2: Common Envelope ── */}
      <Section id="common-envelope" title="Common Envelope">
        <p>All messages follow a standard envelope with sequence number and timestamp.</p>
        <CodeBlock lang="typescript" code={blocks[0]} />
      </Section>

      {/* ── Section 3: Client → Core Events ── */}
      <Section id="client-to-core" title="Client → Core Events">
        <p>Events sent by the client to request task processing or maintain the connection.</p>

        <h3 id={slugify("3.1 task.submit")}>3.1 task.submit</h3>
        <p>Submit a new pipeline task for execution. The <code>data</code> field carries pipeline-specific input.</p>
        <CodeBlock lang="typescript" code={blocks[1]} />

        <h3 id={slugify("3.2 task.cancel")}>3.2 task.cancel</h3>
        <p>Request cancellation of a previously submitted task.</p>
        <CodeBlock lang="typescript" code={blocks[2]} />

        <h3 id={slugify("3.3 ping")}>3.3 ping</h3>
        <p>Keep-alive heartbeat sent periodically by the client.</p>
        <CodeBlock lang="typescript" code={blocks[3]} />
      </Section>

      {/* ── Section 4: Core → Client Events ── */}
      <Section id="core-to-client" title="Core → Client Events">
        <p>
          Events broadcast by Core to all connected clients for a given session.
          These represent the full lifecycle of a task from creation to completion.
        </p>

        <h3 id={slugify("4.1 task.created")}>4.1 task.created</h3>
        <p>Emitted when a task is created and enters the engine queue.</p>
        <CodeBlock lang="typescript" code={blocks[4]} />

        <h3 id={slugify("4.2 task.state-changed")}>4.2 task.state-changed</h3>
        <p>
          Emitted whenever the task transitions between states.
          Possible states: <code>waiting</code>, <code>pending</code>, <code>processing</code>,
          <code>completed</code>, <code>failed</code>, <code>follow_up</code>,
          <code>dispatched</code>, <code>suspended</code>.
        </p>
        <CodeBlock lang="typescript" code={blocks[5]} />

        <h3 id={slugify("4.3 pipeline.element.started")}>4.3 pipeline.element.started</h3>
        <p>Emitted when a pipeline element begins execution. The <code>elementKind</code> identifies the element role.</p>
        <CodeBlock lang="typescript" code={blocks[6]} />

        <h3 id={slugify("4.4 pipeline.element.finished")}>4.4 pipeline.element.finished</h3>
        <p>Emitted when a pipeline element completes, including execution duration.</p>
        <CodeBlock lang="typescript" code={blocks[7]} />

        <h3 id={slugify("4.5 transport.delta")}>4.5 transport.delta</h3>
        <p>Streaming incremental text sent from the LLM during response generation.</p>
        <CodeBlock lang="typescript" code={blocks[8]} />

        <h3 id={slugify("4.6 transport.tool.started")}>4.6 transport.tool.started</h3>
        <p>Emitted when a tool invocation begins. Includes tool metadata and input.</p>
        <CodeBlock lang="typescript" code={blocks[9]} />

        <h3 id={slugify("4.7 transport.tool.finished")}>4.7 transport.tool.finished</h3>
        <p>
          Emitted when a tool invocation completes, including output, error status, and duration.
        </p>
        <CodeBlock lang="typescript" code={blocks[10]} />

        <h3 id={slugify("4.8 task.completed")}>4.8 task.completed</h3>
        <p>
          Emitted when a task finishes successfully. The <code>result</code> payload indicates
          the completion type and any child/parent task transitions.
        </p>
        <CodeBlock lang="typescript" code={blocks[11]} />

        <h3 id={slugify("4.9 task.failed")}>4.9 task.failed</h3>
        <p>Emitted when a task terminates with an error. The payload includes the failing element and error code.</p>
        <CodeBlock lang="typescript" code={blocks[12]} />

        <h3 id={slugify("4.10 pong")}>4.10 pong</h3>
        <p>Response to the client <code>ping</code> event.</p>
        <CodeBlock lang="typescript" code={blocks[13]} />
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
        <CodeBlock lang="typescript" code={blocks[14]} />

        <h3 id={slugify("5.2 replay.event")}>5.2 replay.event</h3>
        <p>Emitted for each recorded event during replay. The <code>event</code> field wraps any server event.</p>
        <CodeBlock lang="typescript" code={blocks[15]} />

        <h3 id={slugify("5.3 replay.end")}>5.3 replay.end</h3>
        <p>Signals the end of a replay session with the total event count.</p>
        <CodeBlock lang="typescript" code={blocks[16]} />
      </Section>

      {/* ── Section 6: Event Type Registry ── */}
      <Section id="event-type-registry" title="Event Type Registry">
        <Callout type="warn" title="Do Not Edit Manually">
          This registry is the source of truth for all event type strings. The TypeScript
          <code>as const</code> assertion ensures type-safety across the entire codebase.
        </Callout>
        <CodeBlock lang="typescript" code={blocks[17]} />
      </Section>

      {/* ── Section 7: Gateway Authentication ── */}
      <Section id="gateway-auth" title="Gateway Authentication">
        <p>
          The Gateway validates a JWT token during the WebSocket upgrade handshake.
          The JWT is sent as a <code>Bearer</code> token in the <code>Authorization</code> header.
        </p>
        <CodeBlock lang="typescript" code={blocks[18]} />
        <Callout type="info" title="WebSocket Upgrade">
          Request: <code>GET ws://gateway:3000/ws/:sessionId</code> with
          header <code>Authorization: Bearer &lt;jwt&gt;</code>.
          The JWT payload includes <code>sub</code>, <code>sessionId</code>,
          <code>permissions</code>, <code>exp</code>, and <code>iat</code> claims.
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
        <CodeBlock lang="typescript" code={blocks[19]} />
      </Section>
    </div>
  );
}
