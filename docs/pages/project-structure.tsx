import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge, parseInline } from "./shared";

function extractBlock(content: string, heading: string): string {
  const idx = content.indexOf(heading);
  if (idx === -1) return "";
  const after = content.slice(idx + heading.length);
  const codeStart = after.indexOf("```");
  if (codeStart === -1) return "";
  const langEnd = after.indexOf("\n", codeStart);
  const codeEnd = after.indexOf("```", langEnd + 1);
  if (codeEnd === -1) return "";
  return after.slice(langEnd + 1, codeEnd).trim();
}

function packagesSection(content: string) {
  return {
    shared: extractBlock(content, "## 2. Package: `shared`"),
    core: extractBlock(content, "## 3. Package: `core`"),
    gateway: extractBlock(content, "## 4. Package: `gateway`"),
    tui: extractBlock(content, "## 5. Package: `tui`"),
  };
}

type PackageInfo = {
  name: string;
  label: string;
  color: "blue" | "green" | "orange" | "purple";
  description: string;
};

const PACKAGES: PackageInfo[] = [
  { name: "shared", label: "shared", color: "blue", description: "Shared types, pipeline core, log system — the foundation of the monorepo. Every other package depends on this." },
  { name: "core", label: "core", color: "green", description: "Core HTTP + WebSocket server, task engine, and tool registry. The central processing unit of the system." },
  { name: "gateway", label: "gateway", color: "orange", description: "External gateway handling JWT authentication, permission evaluation, rate limiting, and request proxying to Core." },
  { name: "tui", label: "tui", color: "purple", description: "Terminal UI application. Connects to Core via WebSocket for real-time streaming and tool execution display." },
];

export default function ProjectStructurePage({ content, title, description, category }: DocPageProps) {
  const sections = packagesSection(content);
  const topLevelTree = extractBlock(content, "## 1. Top-Level Layout");
  const rootPkgJson = extractBlock(content, "## 6. Workspace Root");

  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={4} />

      {/* ── Top-Level Layout ── */}
      <Section title="Top-Level Layout">
        <p>
          The Atom Neo monorepo uses Bun workspaces with four packages under <code>packages/</code>.
        </p>
        <CodeBlock lang="text" code={topLevelTree} />
      </Section>

      {/* ── Package Cards ── */}
      <Section title="Packages">
        <div className="pkg-grid">
          {PACKAGES.map((pkg) => (
            <div key={pkg.name} className="pkg-card">
              <div className="pkg-card__header">
                <Badge color={pkg.color}>{pkg.label}</Badge>
              </div>
              <p className="pkg-card__desc">{pkg.description}</p>
              <CodeBlock lang="text" code={sections[pkg.name as keyof typeof sections]} />
            </div>
          ))}
        </div>
      </Section>

      {/* ── Workspace Root ── */}
      <Section title="Workspace Root">
        <p>
          The root <code>package.json</code> declares the monorepo workspace and common scripts:
        </p>
        <CodeBlock lang="json" code={rootPkgJson} />
      </Section>

      {/* ── Package Dependencies ── */}
      <Section title="Package Dependencies">
        <ComparisonTable
          headers={["Package", "Dependencies", "Depended By"]}
          rows={[
            [
              <span className="pkg-dep-name"><Badge color="blue">shared</Badge></span>,
              <><code>zod</code>, <code>radashi</code></>,
              <span className="dep-list"><code>core</code>, <code>gateway</code>, <code>tui</code></span>,
            ],
            [
              <span className="pkg-dep-name"><Badge color="green">core</Badge></span>,
              <><code>shared</code>, <code>ai</code>, <code>@ai-sdk/deepseek</code>, <code>@ai-sdk/openai</code></>,
              <span className="muted">standalone HTTP service</span>,
            ],
            [
              <span className="pkg-dep-name"><Badge color="orange">gateway</Badge></span>,
              <><code>shared</code>, <code>jose</code></>,
              <span className="muted">standalone HTTP service</span>,
            ],
            [
              <span className="pkg-dep-name"><Badge color="purple">tui</Badge></span>,
              <><code>shared</code>, <code>@opentui/react</code>, <code>react</code></>,
              <span className="muted">standalone application</span>,
            ],
          ]}
        />
        <Callout type="info" title="Dependency Flow">
          <code>shared</code> is the only package depended on by all others. <code>core</code>, <code>gateway</code>, and <code>tui</code> are independent services/applications that share types and pipeline infrastructure through <code>shared</code>.
        </Callout>
      </Section>

      {/* ── Environment Variables ── */}
      <Section title="Environment Variables">
        <p>
          Copy <code>.env.example</code> to <code>.env</code> and fill in the required values:
        </p>
        <CodeBlock lang="bash" code={extractBlock(content, "## 8. Environment Variables")} />
      </Section>

      {/* ── Summary ── */}
      <Callout type="ok" title="Monorepo Summary">
        <strong>4 packages, 1 workspace root</strong> — <code>shared</code> provides types, pipeline core, and logging.
        <code>core</code> runs the HTTP/WebSocket server with event-driven task scheduling.
        <code>gateway</code> secures external access with JWT auth and rate limiting.
        <code>tui</code> delivers the terminal interface via WebSocket streaming.
      </Callout>
    </div>
  );
}
