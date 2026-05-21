import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge, parseInline } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  const blocks = extractCodeBlocks(content);

  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ═══ Section 1: Framework ═══ */}
      <Section title="1. Test Framework">
        <Callout type="info" title="Built-in Runner">
          Uses <strong>Bun's built-in test runner</strong> — no Jest, Vitest, or Mocha needed. Zero config, zero dependencies.
        </Callout>
        <CodeBlock lang="typescript" code={`import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";`} />
      </Section>

      {/* ═══ Section 2: File Naming ═══ */}
      <Section title="2. File Naming Convention">
        <ComparisonTable
          headers={["Source File", "Test File"]}
          rows={[
            [<code>src/session/context.ts</code>, <code>src/session/context.test.ts</code>],
            [<code>src/tools/registry.ts</code>, <code>src/tools/registry.test.ts</code>],
            [<code>src/pipeline/runner.ts</code>, <code>src/pipeline/runner.test.ts</code>],
          ]}
        />
        <Callout type="ok">
          <strong>Rule:</strong> Test file lives next to the source file, suffixed with <code>.test.ts</code>.
        </Callout>
      </Section>

      {/* ═══ Section 3: Test Structure Template ═══ */}
      <Section title="3. Test Structure Template">
        <Callout type="tip" title="The 3-test pattern">
          Every module must have at minimum: a <strong>happy path</strong> test, an <strong>error case</strong> test, and an <strong>edge case</strong> test.
        </Callout>
        <CodeBlock lang="typescript" code={blocks.typescript[0] || ""} />
      </Section>

      {/* ═══ Section 4: Test Naming Rules ═══ */}
      <Section title="4. Test Naming Rules">
        <ComparisonTable
          headers={["Status", "Pattern", "Example"]}
          rows={[
            [<Badge color="green">DO</Badge>, <code>"does &lt;X&gt; when &lt;condition&gt;"</code>, <code>"returns task when pipeline completes"</code>],
            [<Badge color="green">DO</Badge>, <code>"throws when &lt;condition&gt;"</code>, <code>"throws when element is not registered"</code>],
            [<Badge color="green">DO</Badge>, <code>"passes through on &lt;condition&gt;"</code>, <code>"passes through on mismatched mode"</code>],
            [<Badge color="red">DON'T</Badge>, "Vague descriptions", <code>"test task"</code>],
            [<Badge color="red">DON'T</Badge>, "Non-descriptive", <code>"it works"</code>],
            [<Badge color="red">DON'T</Badge>, <>"Should → does"</>, <code>"should work"</code>],
          ]}
        />
      </Section>

      {/* ═══ Section 5: Mocking Rules ═══ */}
      <Section title="5. Mocking Rules">
        <Callout type="warn" title="Mock only external services">
          Never mock what you don't own unless it's an external service (LLM, DB, HTTP). Prefer real implementations for internal dependencies.
        </Callout>
        <CodeBlock lang="typescript" code={blocks.typescript[1] || ""} />
      </Section>

      {/* ═══ Section 6: Element Testing ═══ */}
      <Section title="6. Element Testing">
        <Callout type="info" title="Every Element MUST test 3 things">
          1. <strong>Mode gating</strong> — passes through when mode doesn't match
          <br />
          2. <strong>Correct processing</strong> — transitions state when mode matches
          <br />
          3. <strong>Event emission</strong> — reports element data on processing
        </Callout>
        <CodeBlock lang="typescript" code={blocks.typescript[2] || ""} />
      </Section>

      {/* ═══ Section 7: Pipeline Testing ═══ */}
      <Section title="7. Pipeline Testing (Integration)">
        <Callout type="tip">
          Full pipeline integration tests mock the LLM output and verify the complete element chain produces the expected result.
        </Callout>
        <CodeBlock lang="typescript" code={blocks.typescript[3] || ""} />
      </Section>

      {/* ═══ Section 8: HTTP API Testing ═══ */}
      <Section title="8. HTTP API Testing">
        <CodeBlock lang="typescript" code={blocks.typescript[4] || ""} />
      </Section>

      {/* ═══ Section 9: WebSocket Testing ═══ */}
      <Section title="9. WebSocket Testing">
        <CodeBlock lang="typescript" code={blocks.typescript[5] || ""} />
      </Section>

      {/* ═══ Section 10: Coverage Standards ═══ */}
      <Section title="10. Coverage Standards">
        <ComparisonTable
          headers={[<>Component</>, "Minimum Coverage"]}
          rows={[
            [<>Pipeline Elements</>, <Badge color="green">100%</Badge>],
            [<>Pipeline Runner</>, <Badge color="green">100%</Badge>],
            [<>Task Engine</>, <Badge color="green">100%</Badge>],
            [<>Tool Registry</>, <Badge color="green">100%</Badge>],
            [<>Session Store</>, <Badge color="green">100%</Badge>],
            [<>Pipeline Builder</>, <Badge color="green">100%</Badge>],
            [<>HTTP handlers</>, <Badge color="orange">90%+</Badge>],
            [<>Gateway auth</>, <Badge color="green">100%</Badge>],
            [<>Replay system</>, <Badge color="green">100%</Badge>],
          ]}
        />
        <Callout type="warn" title="Note">
          Pipeline Elements require 3 aspects covered: mode gate, processing, and transition. 100% means all three.
        </Callout>
      </Section>

      {/* ═══ Testing Rules Summary ═══ */}
      <Section title="Testing Rules Summary">
        <ComparisonTable
          headers={["Category", "Rule"]}
          rows={[
            ["Framework", <>"Use Bun's built-in <code>bun:test</code> — no external test runners"</>],
            ["File Location", "Test files co-located with source: `foo.ts` → `foo.test.ts`"],
            ["Naming", <code>"does &lt;X&gt; when &lt;condition&gt;"</code>],
            ["Mocking", "Only mock external services (LLM, HTTP). Use real implementations for internals."],
            ["Structure", "Happy path + error case + edge case minimum"],
            ["Coverage", "100% for pipeline elements, runner, task engine, tools, session store, builder, auth, replay"],
            ["Assertions", <>Use <code>expect</code> from <code>bun:test</code></>],
            ["Setup", <><code>beforeEach</code> for per-test setup, <code>afterEach</code> for mock reset</>],
          ]}
        />
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
