import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge, parseInline } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  const blocks = extractCodeBlocks(content);

  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ═══ Section 1: Loading Precedence ═══ */}
      <Section title="1. Loading Precedence">
        <div className="precedence-flow">
          <div className="prec-step prec-step--highest">
            <Badge color="red">1</Badge>
            <div className="prec-label">CLI arguments</div>
            <code className="prec-example">--port 3100</code>
          </div>
          <div className="prec-arrow">→ overrides →</div>
          <div className="prec-step">
            <Badge color="orange">2</Badge>
            <div className="prec-label">Environment variables</div>
            <code className="prec-example">$CORE_PORT=3100</code>
          </div>
          <div className="prec-arrow">→ overrides →</div>
          <div className="prec-step">
            <Badge color="purple">3</Badge>
            <div className="prec-label">Config file</div>
            <code className="prec-example">core.config.json</code>
          </div>
          <div className="prec-arrow">→ overrides →</div>
          <div className="prec-step prec-step--lowest">
            <Badge color="blue">4</Badge>
            <div className="prec-label">Default values</div>
            <code className="prec-example">port: 3000</code>
          </div>
        </div>
        <Callout type="info" title="loadConfig() Flow">
          1. Read defaults from <code>defaults.ts</code> → 2. Overlay config file (JSON) → 3. Overlay <code>.env</code> via <code>Bun.env</code> → 4. Overlay CLI args via <code>Bun.argv</code> → 5. Validate with Zod schema.
        </Callout>
      </Section>

      {/* ═══ Section 2: Core Config ═══ */}
      <Section title="2. Core Config">
        <p>The core config is validated using Zod and loaded with explicit precedence merging.</p>
        <CodeBlock lang="typescript" code={blocks.typescript[0] || ""} />
      </Section>

      {/* ═══ Section 3: Gateway Config ═══ */}
      <Section title="3. Gateway Config">
        <CodeBlock lang="typescript" code={blocks.typescript[1] || ""} />
      </Section>

      {/* ═══ Section 4: TUI Config ═══ */}
      <Section title="4. TUI Config">
        <CodeBlock lang="typescript" code={blocks.typescript[2] || ""} />
      </Section>

      {/* ═══ Section 5: CLI Argument Parsing ═══ */}
      <Section title="5. CLI Argument Parsing">
        <ComparisonTable
          headers={["Flag", "Type", "Maps to"]}
          rows={[
            [<code>--port</code>, "number", <code>config.port</code>],
            [<code>--host</code>, "string", <code>config.host</code>],
            [<code>--log-level</code>, <>"debug | info | warn | error"</>, <code>config.logLevel</code>],
            [<code>--config</code>, "path", "Load alternative config file"],
            [<code>--help</code>, "flag", "Print help and exit"],
          ]}
        />
        <CodeBlock lang="typescript" code={blocks.typescript[3] || ""} />
      </Section>

      {/* ═══ Section 6: Config Validation Rules ═══ */}
      <Section title="6. Config Validation Rules">
        <Callout type="warn" title="Post-Zod Validation">
          Additional validation beyond the Zod schema — performed after <code>CoreConfigSchema.parse()</code>.
        </Callout>
        <ComparisonTable
          headers={["Rule", "Condition", "Error Message"]}
          rows={[
            ["Port permission", <code>port &lt; 1024 && uid !== 0</code>, <>"Port {port} requires root. Use port &gt;= 1024."</>],
            ["Session minimum", <code>maxSessions &lt; 1</code>, <>"maxSessions must be &gt;= 1"</>],
            ["Task timeout floor", <code>taskTimeoutMs &lt; 1000</code>, <>"taskTimeoutMs must be &gt;= 1000ms"</>],
            ["DB directory", <code>!existsSync(dbDir)</code>, "Auto-creates directory via mkdirSync"],
          ]}
        />
        <CodeBlock lang="typescript" code={blocks.typescript[4] || ""} />
      </Section>

      {/* ═══ Section 7: Accessing Config at Runtime ═══ */}
      <Section title="7. Accessing Config at Runtime">
        <Callout type="warn" title="NEVER import config directly">
          Config is loaded ONCE at startup and passed down via constructor injection. Never import config directly in element/service code.
        </Callout>
        <div className="cmp">
          <div>
            <h4><Badge color="red">BAD</Badge> Direct import</h4>
            <CodeBlock lang="typescript" code={`import { config } from "../config";`} />
          </div>
          <div>
            <h4><Badge color="green">GOOD</Badge> Constructor injection</h4>
            <CodeBlock lang="typescript" code={`class MyService {
  #config: CoreConfig;
  constructor(config: CoreConfig) {
    this.#config = config;
  }
}`} />
          </div>
        </div>
        <CodeBlock lang="typescript" code={blocks.typescript[5] || ""} />
      </Section>

      {/* ═══ Section 8: Secrets Management ═══ */}
      <Section title="8. Secrets Management">
        <Callout type="warn" title="Secrets NEVER go in config files or code">
          Use <code>.env</code> file (gitignored), environment variables (DOCKER_SECRET, systemd EnvironmentFile), or Vault / cloud secret manager for production.
        </Callout>
        <CodeBlock lang="text" code={`# .env (gitignored):
CORE_PORT=3100
DEEPSEEK_API_KEY=sk-xxx
OPENAI_API_KEY=sk-xxx
GATEWAY_JWT_SECRET=supersecret-min-16-chars

# .gitignore:
.env
*.config.json
data/`} />
      </Section>

      {/* ═══ Section 9: Config Hot Reload ═══ */}
      <Section title="9. Config Hot Reload (Future)">
        <Callout type="tip" title="Planned Enhancement">
          NOT in Phase 1. Some config values can be changed at runtime without restart: <code>logLevel</code>, <code>replayEnabled</code>, <code>transportMaxOutputTokens</code>, <code>taskTimeoutMs</code>.
        </Callout>
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
