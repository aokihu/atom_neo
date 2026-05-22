import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge, parseInline } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  const blocks = extractCodeBlocks(content);

  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ═══ Section 1: Core Principle ═══ */}
      <Section title="1. Core Principle">
        <Callout type="info" title="Whoever creates an object, provides its dependencies.">
          There is <strong>NO DI container</strong>. The bootstrap function in <code>server.ts</code> is the <strong>ONLY</strong> place where objects are constructed. All other code receives pre-built dependencies.
        </Callout>
      </Section>

      {/* ═══ Section 2: The Construction Chain ═══ */}
      <Section title="2. The Construction Chain">
        <div className="dep-graph">
          <div className="dep-graph__chain" style={{ flexDirection: "column", alignItems: "flex-start" }}>
            {[
              "bootstrap()",
              "  ├── config = loadConfig()",
              "  ├── logger = createLogger(config)",
              "  ├── memoryService = new MemoryService({ dbPath }) → start()",
              "  ├── sessionStore = new SessionStore({ maxSessions })",
              "  ├── toolRegistry = new ToolRegistry() → register(readTool, writeTool, searchMemoryTool)",
              "  ├── bus = new PipelineEventBus<PipelineEventMap>()",
              "  ├── elementRegistry = new Map() → register(CollectPrompts, StreamLLM, ...)",
              "  ├── pipelineManager = new PipelineManager(elementRegistry) → registerPipelines(...)",
              "  ├── taskQueue = new TaskQueue()",
              "  ├── taskEngine = new TaskEngine({ bus, taskQueue, pipelineManager, sessionStore }) → start()",
              "  └── server = Bun.serve({ ... })",
            ].map((line, i) => (
              <div key={i} style={{ fontFamily: "monospace", fontSize: "0.9em", lineHeight: "1.8" }}>
                {parseInline(line)}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ═══ Section 3: Constructor Pattern ═══ */}
      <Section title="3. Constructor Injection Pattern">
        <p>Every constructor follows the same pattern: a single typed <code>params</code> object, private readonly fields, no defaults for services.</p>
        <CodeBlock lang="typescript" code={blocks.typescript[0] || ""} />

        <h3>Constructor Rules</h3>
        <ComparisonTable
          headers={["Rule", "Detail"]}
          rows={[
            ["Single params object", "Constructor takes one <code>params</code> object — not positional args"],
            ["Private fields", "Dependencies stored as <code>#private</code> fields — no public access"],
            ["No defaults for services", "Services must be provided — config can have defaults if appropriate"],
            ["No `new` in constructors", <>"NEVER <code>new</code> anything in a constructor that isn't explicitly passed in"</>],
          ]}
        />
      </Section>

      {/* ═══ Section 4: Anti-Patterns ═══ */}
      <Section title="4. What NOT to Do">
        <Callout type="warn" title="These patterns are banned">
          Global singletons, factory hiding dependencies, service locators, and lazy initialization all violate the DI principle.
        </Callout>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="cmp">
            <div>
              <h4><Badge color="red">BAD</Badge> Global Singleton</h4>
              <CodeBlock lang="typescript" code={`const globalRuntime = new Runtime();
export function getRuntime() { return globalRuntime; }`} />
            </div>
            <div>
              <h4><Badge color="red">BAD</Badge> Factory Hiding Dependencies</h4>
              <CodeBlock lang="typescript" code={`class ElementFactory {
  static createCollectPrompts() {
    return new CollectPromptsElement({
      runtime: getGlobalRuntime(), // hidden!
      bus: getGlobalBus(),
    });
  }
}`} />
            </div>
          </div>
          <div className="cmp">
            <div>
              <h4><Badge color="red">BAD</Badge> Service Locator</h4>
              <CodeBlock lang="typescript" code={`class MyElement {
  constructor() {
    this.runtime = ServiceLocator.get("runtime"); // hidden!
  }
}`} />
            </div>
            <div>
              <h4><Badge color="red">BAD</Badge> Lazy Initialization</h4>
              <CodeBlock lang="typescript" code={`class MyService {
  #db?: Database;
  getDb() {
    if (!this.#db) this.#db = new Database(); // hidden!
    return this.#db;
  }
}`} />
            </div>
          </div>
        </div>
      </Section>

      {/* ═══ Section 5: Config Slicing ═══ */}
      <Section title="5. Config Slicing — Don't Pass Entire Config">
        <Callout type="warn" title="Pass only what's needed">
          Passing the whole <code>CoreConfig</code> (20+ fields) when only 2 are needed creates coupling and confusion. Slice config at the bootstrap boundary.
        </Callout>
        <div className="cmp">
          <div>
            <h4><Badge color="red">BAD</Badge> Whole Config</h4>
            <CodeBlock lang="typescript" code={`class MemoryService {
  constructor(config: CoreConfig) {
    this.#dbPath = config.memoryDbPath;
    this.#maxResults = config.maxSessions; // wrong field!
  }
}`} />
          </div>
          <div>
            <h4><Badge color="green">GOOD</Badge> Sliced Config</h4>
            <CodeBlock lang="typescript" code={`class MemoryService {
  constructor(params: { dbPath: string }) {
    this.#dbPath = params.dbPath;
  }
}
// In bootstrap:
new MemoryService({ dbPath: config.memoryDbPath })`} />
          </div>
        </div>
      </Section>

      {/* ═══ Section 6: AppContext Pattern ═══ */}
      <Section title="6. AppContext Pattern (Optional)">
        <Callout type="tip" title="For deeply nested trees only">
          When multiple subsystems share the same dependencies, group them into a <code>RuntimeDeps</code> type. But keep it <strong>SMALL (&le;5 fields)</strong>. If it grows, split into smaller groups.
        </Callout>
        <CodeBlock lang="typescript" code={blocks.typescript[1] || ""} />
      </Section>

      {/* ═══ Section 7: Testing with DI ═══ */}
      <Section title="7. Testing with DI">
        <Callout type="ok" title="No mocking framework needed for most tests">
          Because everything is constructor-injected, testing is trivial — pass test doubles directly in the constructor. Only mock external services (LLM, HTTP).
        </Callout>
        <CodeBlock lang="typescript" code={blocks.typescript[2] || ""} />
      </Section>

      {/* ═══ Section 8: Lifecycle Methods ═══ */}
      <Section title="8. Lifecycle Methods">
        <ComparisonTable
          headers={["Interface", "Method", "Who Implements"]}
          rows={[
            [<code>Startable</code>, <code>start(): Promise&lt;void&gt;</code>, "Services — open DB, create tables, connect"],
            [<code>Stoppable</code>, <code>stop(): Promise&lt;void&gt;</code>, "Services — close DB, flush writes, disconnect"],
            [<span className="muted">Neither</span>, <span className="muted">N/A</span>, "Elements — stateless processing units, lifecycle managed by PipelineRunner"],
          ]}
        />
      </Section>

      {/* ═══ Section 9: Async Init Anti-Pattern ═══ */}
      <Section title="9. Async Init Anti-Pattern">
        <Callout type="warn" title="Constructors must be synchronous">
          Fire-and-forget <code>this.init()</code> in a constructor creates race conditions. Use an explicit <code>start()</code> method for async initialization.
        </Callout>
        <div className="cmp">
          <div>
            <h4><Badge color="red">BAD</Badge> Constructor init</h4>
            <CodeBlock lang="typescript" code={`class BadService {
  constructor() {
    this.init(); // Fire-and-forget! Race!
  }
  async init() { /* ... */ }
}`} />
          </div>
          <div>
            <h4><Badge color="green">GOOD</Badge> Explicit start()</h4>
            <CodeBlock lang="typescript" code={`class GoodService {
  constructor(params: { dbPath: string }) {
    this.#dbPath = params.dbPath; // Store only
  }
  async start() {
    this.#db = await openDatabase(this.#dbPath);
  }
}`} />
          </div>
        </div>
      </Section>

      {/* ═══ Section 10: Dependency Validation ═══ */}
      <Section title="10. Dependency Validation at Startup">
        <Callout type="ok" title="Fail fast">
          Bootstrap should validate critical dependencies before starting: JWT secret length, tool registry has entries, file paths exist.
        </Callout>
        <CodeBlock lang="typescript" code={blocks.typescript[3] || ""} />
      </Section>

      {/* ═══ Why DI Matters ═══ */}
      <Callout type="tip" title="Why Dependency Injection Matters">
        <strong>Testability:</strong> Every component is testable in isolation with mock dependencies passed to the constructor.
        <br />
        <strong>Readability:</strong> The constructor is a manifest of a component's dependencies — no hidden coupling.
        <br />
        <strong>Flexibility:</strong> Swap implementations without changing dependent code. Memory service could use SQLite, JSON files, or Redis — consumers never know.
        <br />
        <strong>Fail Fast:</strong> Missing dependencies are caught at construction time, not 30s into processing.
      </Callout>
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
