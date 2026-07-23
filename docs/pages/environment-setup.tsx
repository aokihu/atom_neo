import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, Badge, parseInline } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  const blocks = extractCodeBlocks(content);

  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ═══ Section 1: Prerequisites ═══ */}
      <Section title="1. Prerequisites">
        <Callout type="ok" title="Required Tools Checklist">
          <div className="checklist">
            <div className="checklist__item checklist__item--done">
              <Badge color="green">✓</Badge>
              <span><strong>Bun</strong> &gt;= 1.3.0 — JavaScript runtime + package manager</span>
            </div>
            <div className="checklist__item checklist__item--done">
              <Badge color="green">✓</Badge>
              <span><strong>Git</strong> — Version control</span>
            </div>
            <div className="checklist__item">
              <Badge color="blue">?</Badge>
              <span><strong>Direnv</strong> (optional) — Auto-load .env files</span>
            </div>
          </div>
        </Callout>
        <CodeBlock lang="bash" code={blocks.bash ? blocks.bash[0] : ""} />
      </Section>

      {/* ═══ Section 2: Clone and Install ═══ */}
      <Section title="2. Clone and Install">
        <div className="step-card">
          <div className="step-card__number">
            <Badge color="blue">1</Badge>
          </div>
          <div className="step-card__body">
            <h4>Clone the repository</h4>
            <CodeBlock lang="bash" code={`git clone <repo-url> atom_neo
cd atom_neo`} />
          </div>
        </div>
        <div className="step-card">
          <div className="step-card__number">
            <Badge color="blue">2</Badge>
          </div>
          <div className="step-card__body">
            <h4>Install dependencies</h4>
            <CodeBlock lang="bash" code="bun install" />
            <p className="muted">Installs all workspace dependencies across all packages.</p>
          </div>
        </div>
      </Section>

      {/* ═══ Section 3: Environment Variables ═══ */}
      <Section title="3. Environment Variables">
        <div className="step-card">
          <div className="step-card__number">
            <Badge color="orange">1</Badge>
          </div>
          <div className="step-card__body">
            <h4>Create .env from template</h4>
            <CodeBlock lang="bash" code={`cp .env.example .env
# Edit with your editor: nano .env / vim .env / code .env`} />
          </div>
        </div>
        <Callout type="warn" title="Required Variables">
          <code>DEEPSEEK_API_KEY</code> is required. All others have sensible defaults.
        </Callout>
        <CodeBlock lang="bash" code={`# Required:
DEEPSEEK_API_KEY=sk-your-key-here

# Optional (defaults are fine for dev):
CORE_PORT=3100
GATEWAY_PORT=3000
LOG_LEVEL=debug
MEMORY_DB_PATH=./data/memory.db
REPLAY_ENABLED=true`} />
      </Section>

      {/* ═══ Section 4: Verify Setup ═══ */}
      <Section title="4. Verify Setup">
        <div className="step-card">
          <div className="step-card__number">
            <Badge color="green">1</Badge>
          </div>
          <div className="step-card__body">
            <h4>Type check all packages</h4>
            <CodeBlock lang="bash" code="bun run typecheck" />
          </div>
        </div>
        <div className="step-card">
          <div className="step-card__number">
            <Badge color="green">2</Badge>
          </div>
          <div className="step-card__body">
            <h4>Run all tests</h4>
            <CodeBlock lang="bash" code="bun test" />
            <Callout type="ok">
              Expected output: <strong>X pass, 0 fail</strong>
            </Callout>
          </div>
        </div>
      </Section>

      {/* ═══ Section 5: Start Development ═══ */}
      <Section title="5. Start Development">
        <div className="step-card">
          <div className="step-card__number">
            <Badge color="green">1</Badge>
          </div>
          <div className="step-card__body">
            <h4>Start Core (Terminal 1)</h4>
            <CodeBlock lang="bash" code="bun run --filter @atom-neo/core dev" />
          </div>
        </div>
        <div className="step-card">
          <div className="step-card__number">
            <Badge color="orange">2</Badge>
          </div>
          <div className="step-card__body">
            <h4>Start Gateway — optional, for API testing (Terminal 2)</h4>
            <CodeBlock lang="bash" code="bun run --filter @atom-neo/gateway dev" />
          </div>
        </div>
        <div className="step-card">
          <div className="step-card__number">
            <Badge color="purple">3</Badge>
          </div>
          <div className="step-card__body">
            <h4>Start TUI — optional, for terminal testing (Terminal 3)</h4>
            <CodeBlock lang="bash" code="bun run --filter @atom-neo/tui dev" />
          </div>
        </div>
        <Callout type="tip" title="Shortcut">
          Start everything at once: <code>bun run dev:all</code>
        </Callout>
      </Section>

      {/* ═══ Section 6: Verify Running ═══ */}
      <Section title="6. Verify Running">
        <div className="step-card">
          <div className="step-card__number">
            <Badge color="blue">1</Badge>
          </div>
          <div className="step-card__body">
            <h4>Core health check</h4>
            <CodeBlock lang="bash" code={`curl http://localhost:3100/api/health
# Expected: {"status":"ok","uptime":12,"queue":{"waiting":0,"processing":0},"sessions":0}`} />
          </div>
        </div>
        <div className="step-card">
          <div className="step-card__number">
            <Badge color="blue">2</Badge>
          </div>
          <div className="step-card__body">
            <h4>Submit a test task</h4>
            <CodeBlock lang="bash" code={`curl -X POST http://localhost:3100/api/tasks \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionId": "test-session",
    "chatId": "test-chat",
    "pipeline": "conversation",
    "source": "external",
    "data": { "text": "Hello, world!" }
  }'
# Expected: {"taskId":"...","state":"waiting"}`} />
          </div>
        </div>
      </Section>

      {/* ═══ Section 7: WebSocket Test ═══ */}
      <Section title="7. WebSocket Test">
        <CodeBlock lang="bash" code={`wscat -c ws://localhost:3100/ws/test-session

# Send a task:
{"type":"task.submit","seq":0,"ts":1700000000,"payload":{...}}

# Expected streaming events:
# {"type":"event.task.created","seq":1,"ts":...,"payload":{"taskId":"...","state":"pending"}}
# {"type":"event.pipeline.element.started","seq":2,"ts":...,"payload":{"elementName":"CollectPrompts",...}}
# {"type":"event.transport.delta","seq":3,"ts":...,"payload":{"taskId":"...","textDelta":"Hello"}}
# {"type":"event.task.completed","seq":...,"ts":...,"payload":{"taskId":"...","result":{...}}}`} />
      </Section>

      {/* ═══ Section 8: Directory Structure ═══ */}
      <Section title="8. Directory Structure After Setup">
        <CodeBlock lang="text" code={`atom_neo/
├── .env                  # Your local environment (gitignored)
├── .env.example          # Template for new developers
├── .gitignore
├── package.json          # Workspace root
├── bun.lock              # Lockfile
├── data/
│   └── memory.db         # SQLite database (auto-created, gitignored)
├── packages/
│   ├── shared/
│   ├── core/
│   ├── gateway/
│   └── tui/
├── docs/
│   └── ... (all docs)
└── node_modules/`} />
      </Section>

      {/* ═══ Section 9: Common Issues ═══ */}
      <Section title="9. Common Issues">
        <div className="issue-cards">
          {[
            { icon: "🔧", title: "bun: command not found", fix: "curl -fsSL https://bun.sh/install | bash" },
            { icon: "📦", title: "Cannot find module '@atom-neo/shared'", fix: "bun install" },
            { icon: "🔌", title: "Port 3100 already in use", fix: "lsof -ti:3100 | xargs kill -9" },
            { icon: "🔑", title: "DEEPSEEK_API_KEY not set", fix: "Set in .env or export DEEPSEEK_API_KEY=sk-xxx" },
            { icon: "🔒", title: "Tests fail with Database is locked", fix: "rm -f data/memory.db && bun test" },
            { icon: "📝", title: "TypeScript errors about missing types", fix: "bun run typecheck" },
          ].map((issue, i) => (
            <div className="issue-card" key={i}>
              <div className="issue-card__icon">{issue.icon}</div>
              <div className="issue-card__body">
                <div className="issue-card__title">{issue.title}</div>
                <CodeBlock lang="bash" code={issue.fix} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══ Section 10: Development Workflow ═══ */}
      <Section title="10. Development Workflow">
        <div className="step-card">
          <div className="step-card__number"><Badge color="blue">1</Badge></div>
          <div className="step-card__body">
            <h4>Create a new branch</h4>
            <CodeBlock lang="bash" code="git checkout -b feature/my-feature" />
          </div>
        </div>
        <div className="step-card">
          <div className="step-card__number"><Badge color="blue">2</Badge></div>
          <div className="step-card__body"><h4>Make changes — edit code, follow docs/</h4></div>
        </div>
        <div className="step-card">
          <div className="step-card__number"><Badge color="blue">3</Badge></div>
          <div className="step-card__body">
            <h4>Type check</h4>
            <CodeBlock lang="bash" code="bun run typecheck" />
          </div>
        </div>
        <div className="step-card">
          <div className="step-card__number"><Badge color="blue">4</Badge></div>
          <div className="step-card__body">
            <h4>Run tests</h4>
            <CodeBlock lang="bash" code={`bun test                 # All tests
bun test src/packages/core   # Core only
bun test --watch         # Watch mode`} />
          </div>
        </div>
        <div className="step-card">
          <div className="step-card__number"><Badge color="blue">5</Badge></div>
          <div className="step-card__body">
            <h4>Commit</h4>
            <CodeBlock lang="bash" code={`git add -A
git commit -m "feat(core): description"`} />
          </div>
        </div>
        <div className="step-card">
          <div className="step-card__number"><Badge color="blue">6</Badge></div>
          <div className="step-card__body">
            <h4>Push</h4>
            <CodeBlock lang="bash" code="git push origin feature/my-feature" />
          </div>
        </div>
      </Section>

      {/* ═══ Section 11: IDE Setup ═══ */}
      <Section title="11. IDE Setup (VS Code)">
        <div className="cmp">
          <div>
            <h4>settings.json</h4>
            <CodeBlock lang="json" code={`{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.preferences.importModuleSpecifier": "non-relative",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.organizeImports": "explicit"
  }
}`} />
          </div>
          <div>
            <h4>extensions.json</h4>
            <CodeBlock lang="json" code={`{
  "recommendations": [
    "bun.bun-vscode"
  ]
}`} />
          </div>
        </div>
      </Section>

      {/* ═══ Section 12: CI Setup ═══ */}
      <Section title="12. CI Setup (GitHub Actions)">
        <CodeBlock lang="yaml" code={blocks.yaml ? blocks.yaml[0] : ""} />
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
