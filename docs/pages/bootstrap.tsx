import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, Badge, parseInline } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  const blocks = extractCodeBlocks(content);

  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ═══ Section 1: Startup Philosophy ═══ */}
      <Section title="1. Startup Philosophy">
        <Callout type="warn" title="Core Rule">
          Nothing starts until its dependencies are ready. Every component has a <code>start(): Promise&lt;void&gt;</code> method. Failures during init prevent the process from accepting traffic — <strong>fail fast, don't start broken</strong>.
        </Callout>
      </Section>

      {/* ═══ Section 2: Core Package — Startup Order ═══ */}
      <Section title="2. Core Package — Startup Order">
        <div className="timeline">
          {[
            { step: 1, label: "Load Configuration", desc: "config.load() — reads .env, CLI args, config file" },
            { step: 2, label: "Initialize Log System", desc: "LogHub.create() → register sinks (stdout, file)" },
            { step: 3, label: "Register Builtin Elements", desc: "elementRegistry.set(...) — all pipeline elements" },
            { step: 4, label: "Register Builtin Tools", desc: "toolRegistry.register(...) — all tools" },
            { step: 5, label: "Initialize Services", desc: "serviceManager.register(memoryService) → startAll()" },
            { step: 6, label: "Initialize Session Store", desc: "new SessionStore(config.maxSessions)" },
            { step: 7, label: "Initialize Task Engine", desc: "new TaskEngine(bus, taskQueue, pipelineManager, sessionStore)" },
            { step: 8, label: "Build Pipeline Instances", desc: "pipelineManager.register(\"conversation\", ...)" },
            { step: 9, label: "Initialize Replay System", desc: "if (config.replay.enabled) { recorder.start() }" },
            { step: 10, label: "Start HTTP + WebSocket Server", desc: "Bun.serve({ port: config.port, fetch: router, websocket: wsHandler })" },
          ].map((item) => (
            <div className="timeline__item" key={item.step}>
              <div className="timeline__step">
                <Badge color={item.step === 10 ? "green" : "blue"}>{String(item.step)}</Badge>
              </div>
              <div className="timeline__body">
                <div className="timeline__label">{item.label}</div>
                <code className="timeline__desc">{item.desc}</code>
              </div>
            </div>
          ))}
          <div className="timeline__item timeline__item--done">
            <div className="timeline__step"><Badge color="green">✓</Badge></div>
            <div className="timeline__body">
              <div className="timeline__label">READY</div>
              <code className="timeline__desc">log "Core ready on :port"</code>
            </div>
          </div>
        </div>

        <h3>Startup Code Template</h3>
        <CodeBlock lang="typescript" code={blocks.typescript[0] || ""} />
      </Section>

      {/* ═══ Section 3: Gateway Package — Startup Order ═══ */}
      <Section title="3. Gateway Package — Startup Order">
        <div className="timeline">
          {[
            { step: 1, label: "Load Configuration", desc: "gatewayConfig.load()" },
            { step: 2, label: "Initialize Log System", desc: "" },
            { step: 3, label: "Initialize Rate Limiter", desc: "new RateLimiter(config.rateLimit)" },
            { step: 4, label: "Initialize JWT Verifier", desc: "new JWTVerifier(config.jwtSecret)" },
            { step: 5, label: "Initialize Core Proxy", desc: "new CoreProxy(config.coreUrl)" },
            { step: 6, label: "Start HTTP Server", desc: "Bun.serve({ port: config.port, fetch: router })" },
          ].map((item) => (
            <div className="timeline__item" key={item.step}>
              <div className="timeline__step"><Badge color="orange">{String(item.step)}</Badge></div>
              <div className="timeline__body">
                <div className="timeline__label">{item.label}</div>
                {item.desc && <code className="timeline__desc">{item.desc}</code>}
              </div>
            </div>
          ))}
          <div className="timeline__item timeline__item--done">
            <div className="timeline__step"><Badge color="green">✓</Badge></div>
            <div className="timeline__body"><div className="timeline__label">READY</div></div>
          </div>
        </div>
      </Section>

      {/* ═══ Section 4: TUI Package — Startup Order ═══ */}
      <Section title="4. TUI Package — Startup Order">
        <div className="timeline">
          {[
            { step: 1, label: "Load Configuration", desc: "tuiConfig.load()" },
            { step: 2, label: "Connect to Core via WebSocket", desc: "ws = new WebSocket(coreUrl + \"/ws/\" + sessionId)" },
            { step: 3, label: "Wait for \"session.ready\" handshake", desc: "" },
            { step: 4, label: "Initialize React TUI", desc: "render(<App ws={ws} />)" },
          ].map((item) => (
            <div className="timeline__item" key={item.step}>
              <div className="timeline__step"><Badge color="purple">{String(item.step)}</Badge></div>
              <div className="timeline__body">
                <div className="timeline__label">{item.label}</div>
                {item.desc && <code className="timeline__desc">{item.desc}</code>}
              </div>
            </div>
          ))}
          <div className="timeline__item timeline__item--done">
            <div className="timeline__step"><Badge color="green">✓</Badge></div>
            <div className="timeline__body"><div className="timeline__label">READY</div></div>
          </div>
        </div>
      </Section>

      {/* ═══ Section 5: Graceful Shutdown ═══ */}
      <Section title="5. Graceful Shutdown (All Packages)">
        <Callout type="info" title="Shutdown Sequence">
          Stop accepting connections → Drain running tasks → Close WebSocket connections → Stop services → Flush logs → Exit
        </Callout>
        <CodeBlock lang="typescript" code={blocks.typescript[1] || ""} />
      </Section>

      {/* ═══ Section 6: Dependency Graph ═══ */}
      <Section title="6. Dependency Graph">
        <div className="dep-graph">
          <div className="dep-graph__chain">
            <span className="dep-node">config</span>
            <span className="dep-arrow">→</span>
            <span className="dep-node">log</span>
            <span className="dep-arrow">→</span>
            <span className="dep-node">services</span>
            <span className="dep-arrow">→</span>
            <span className="dep-node">tools</span>
            <span className="dep-arrow">→</span>
            <span className="dep-node">elements</span>
            <span className="dep-arrow">→</span>
            <span className="dep-node">pipelines</span>
          </div>
          <div className="dep-graph__branch">
            <span className="dep-node dep-node--secondary">sessionStore</span>
            <span className="dep-arrow">→</span>
            <span className="dep-node dep-node--highlight">taskEngine</span>
            <span className="dep-arrow">→</span>
            <span className="dep-node dep-node--terminal">HTTP Server</span>
          </div>
        </div>
        <Callout type="tip">
          <strong>Rules:</strong> Everything depends on config and log. Services depend on nothing else. Tools depend on services. Elements depend on tools. Pipelines depend on elements. Session store depends only on config. Task engine depends on bus, queue, pipelines, session store. HTTP server depends on everything.
        </Callout>
      </Section>

      {/* ═══ Section 7: Entry Points ═══ */}
      <Section title="7. Entry Points">
        <CodeBlock lang="text" code={`# Each package has its own entry point:
src/packages/core/src/server.ts    → startCore()
src/packages/gateway/src/server.ts  → startGateway()
src/packages/tui/src/app.tsx        → startTUI()

# Package.json scripts (in each package):
"start": "bun run src/server.ts"

# Root scripts (development):
"dev:core":    "bun run --filter @atom-neo/core dev"
"dev:gateway": "bun run --filter @atom-neo/gateway dev"
"dev:tui":     "bun run --filter @atom-neo/tui dev"
"dev:all":     "bun run --workspaces dev"`} />
      </Section>

      {/* ═══ Section 8: Health Check Flow ═══ */}
      <Section title="8. Health Check Flow">
        <Callout type="ok" title="GET /api/health">
          Client → Core responds with JSON containing status, uptime, queue state, session count, memory status, tool count, and version.
        </Callout>
        <CodeBlock lang="json" code={`{
  status: "ok" | "degraded" | "down",
  uptime: 3600,
  queue: { waiting: 3, processing: 1 },
  sessions: 42,
  memory: { connected: true, size: "12MB" },
  tools: { registered: 15, builtin: 12, mcp: 3 },
  version: "1.8.2"
}`} />
      </Section>
    </div>
  );
}

function extractCodeBlocks(md: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const re = /```(\w+)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const lang = m[1];
    if (!result[lang]) result[lang] = [];
    result[lang].push(m[2]);
  }
  return result;
}
