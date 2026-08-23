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
            <Badge color="purple">2</Badge>
            <div className="prec-label">Runtime config (overlay)</div>
            <code className="prec-example">.atom/runtime-config.json</code>
          </div>
          <div className="prec-arrow">→ overrides →</div>
          <div className="prec-step">
            <Badge color="orange">3</Badge>
            <div className="prec-label">User config (baseline)</div>
            <code className="prec-example">config.json</code>
          </div>
          <div className="prec-arrow">→ overrides →</div>
          <div className="prec-step prec-step--lowest">
            <Badge color="blue">4</Badge>
            <div className="prec-label">Default values</div>
            <code className="prec-example">zod .default()</code>
          </div>
        </div>
        <Callout type="info" title="Effective Config">
          <code>effective = deepMerge(config.json, runtime-config.json)</code> — 对象递归合并、数组整体替换、overlay 优先。系统运行全程只读有效配置；用户运行时调整只写 overlay，基线 config.json 永不被动修改。
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

# .gitignore:
.env
*.config.json
data/`} />
      </Section>

      {/* ═══ Section 9: Runtime Adjustment API (TUI only) ═══ */}
      <Section title="9. Runtime Adjustment API (TUI only)">
        <Callout type="tip" title="Dual-Layer Overlay">
          运行时可调字段 = 除 <code>gateway</code> 子树外的全部配置。调整经 admin token 鉴权写入 overlay，<code>config.json</code> 保持不变；<code>getResolvedModel()</code> 动态读取有效配置，切换模型档位后下一轮任务即生效。
        </Callout>
        <ComparisonTable
          headers={["Endpoint", "Method", "Description"]}
          rows={[
            [<code>/api/config</code>, "GET", "返回有效配置（合并后）"],
            [<code>/api/config/runtime</code>, "PATCH", <>"校验并合并 patch → 持久化 overlay → 返回有效配置（<code>gateway</code> 被拒 400）"</>],
            [<code>/api/config/runtime</code>, "DELETE", "清空 overlay，恢复纯用户配置"],
          ]}
        />
        <Callout type="warn" title="Access Control">
          请求必须来自 loopback（127.0.0.1/::1）且携带 <code>x-atom-admin-token</code> 头。Token 由 main.ts 启动时随机生成、仅注入 TUI —— Gateway 与外部 client 无 token，一律 403。
        </Callout>
        <CodeBlock lang="typescript" code={`// TUI 端调整模型档位
await fetch(url + "/api/config/runtime", {
  method: "PATCH",
  headers: { "content-type": "application/json", "x-atom-admin-token": token },
  body: JSON.stringify({ providerProfiles: { balanced: "deepseek/deepseek-v4-pro" } }),
});

// 重置为 config.json 基线
await fetch(url + "/api/config/runtime", {
  method: "DELETE",
  headers: { "x-atom-admin-token": token },
});`} />
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
