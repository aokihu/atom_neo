import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge, parseInline } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  const blocks = extractCodeBlocks(content);

  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ═══ Section 1: Type File Layout ═══ */}
      <Section title="1. Type File Layout">
        <p>All types live in <code>packages/shared/src/types/</code>. Each domain gets its own file with a barrel export.</p>
        <CodeBlock lang="text" code={`packages/shared/src/types/
├── index.ts          # Barrel exports
├── task.ts           # TaskItem, TaskState, TaskPayload, TaskPipeline
├── intent.ts         # IntentRequest, IntentRequestType
├── memory.ts         # MemoryNode, MemoryLink, MemoryScope
├── tool.ts           # ToolDefinition, ToolResult, PermissionLevel
├── pipeline.ts       # PipelineResult, PipelineEventMap, FlowState base types
├── session.ts        # SessionContext types
├── config.ts         # Configuration types
└── primitive.ts      # UUID, ISOTimeString, etc.`} />
      </Section>

      {/* ═══ Section 2: Task Types ═══ */}
      <Section title="2. Task Types">
        <Callout type="info">
          <code>TaskItem</code> is the core data structure. Mutable fields (<code>state</code>, <code>updatedAt</code>) are clearly marked. Immutable fields use <code>readonly</code>.
        </Callout>
        <CodeBlock lang="typescript" code={blocks.typescript[0] || ""} />
      </Section>

      {/* ═══ Section 3: Intent Types ═══ */}
      <Section title="3. Intent Types">
        <p>Intents use discriminated unions with the <code>request</code> field as discriminant, keyed by <code>IntentRequestType</code> enum values.</p>
        <CodeBlock lang="typescript" code={blocks.typescript[1] || ""} />
      </Section>

      {/* ═══ Section 4: Pipeline Types ═══ */}
      <Section title="4. Pipeline Types">
        <Callout type="tip" title="PipelineResult is a discriminated union">
          The <code>type</code> field discriminates between Complete, Enqueue, SuspendAndEnqueueChild, and ResumeParentAndEnqueue variants. Use <code>typeof PipelineResultType.X</code> as the discriminant literal for proper narrowing.
        </Callout>
        <CodeBlock lang="typescript" code={blocks.typescript[2] || ""} />
      </Section>

      {/* ═══ Section 5: Pipeline Event Map ═══ */}
      <Section title="5. Pipeline Event Map">
        <p>The event map defines a typed contract for all events flowing through the <code>PipelineEventBus</code>. Each event has a string type key and a typed payload.</p>
        <CodeBlock lang="typescript" code={blocks.typescript[3] || ""} />
      </Section>

      {/* ═══ Section 6: Primitive Types ═══ */}
      <Section title="6. Primitive Types (Branded)">
        <Callout type="info" title="Opacity via branded types">
          <code>UUID</code> and <code>ISOTimeString</code> use branded intersections with an unused <code>__brand</code> property for nominal typing — prevents accidental string interchange.
        </Callout>
        <CodeBlock lang="typescript" code={`export type UUID = string & { readonly __brand: "UUID" };
export type ISOTimeString = string & { readonly __brand: "ISOTimeString" };`} />
      </Section>

      {/* ═══ Section 7: Type Export Rules ═══ */}
      <Section title="7. Type Export Rules">
        <Callout type="warn" title="Enum vs Type export distinction">
          Enums are runtime values — use <code>export</code> (not <code>export type</code>). Types are compile-time only — use <code>export type</code>. The barrel index must handle both correctly.
        </Callout>
        <CodeBlock lang="typescript" code={`// Barrel exports (index.ts) — export ALL public types:
export type { TaskItem, TaskState, TaskPayload, ... } from "./task";
export type { IntentRequest, IntentRequestType, ... } from "./intent";
export { PipelineResultType, PipelineEnqueueTransition } from "./pipeline";  // Enum → value export
export type { PipelineResult, PipelineEventMap } from "./pipeline";           // Type → type export`} />
      </Section>

      {/* ═══ Section 8: Discriminated Union Pattern ═══ */}
      <Section title="8. Discriminated Union Pattern">
        <Callout type="tip" title="Universal convention">
          ALL discriminated unions in this project follow this pattern. The discriminant field is named <code>type</code> (for results) or <code>mode</code> (for FlowState). Enum values serve as discriminant literals.
        </Callout>
        <div className="cmp">
          <div>
            <h4>Pattern Definition</h4>
            <CodeBlock lang="typescript" code={`export type MyUnion =
  | { type: typeof MyEnum.VariantA; fieldA: string }
  | { type: typeof MyEnum.VariantB; fieldB: number };`} />
          </div>
          <div>
            <h4>Usage with Narrowing</h4>
            <CodeBlock lang="typescript" code={`function handle(input: MyUnion) {
  if (input.type === MyEnum.VariantA) {
    input.fieldA;  // narrowed
  }
}`} />
          </div>
        </div>

        <h3>Real Examples in the Codebase</h3>
        <ComparisonTable
          headers={[<>Type</>, "Discriminant", "Variants"]}
          rows={[
            [<code>PipelineResult</code>, <code>type</code>, <>"Complete | Enqueue | SuspendAndEnqueueChild | ResumeParentAndEnqueue"</>],
            [<code>TaskPayload</code>, <code>type</code>, <>"text | image | audio | tool_report | memory_search_request"</>],
            [<code>IntentRequest</code>, <code>request</code>, <>"FOLLOW_UP"</>],
            [<><code>FlowState</code> (conceptual)</>, <code>mode</code>, <>"initial | streaming | readyToFinalize"</>],
          ]}
        />
      </Section>

      {/* ═══ Type Rules Summary ═══ */}
      <Section title="Type System Rules">
        <ComparisonTable
          headers={["Category", "Rule"]}
          rows={[
            ["Location", <>"All shared types in <code>packages/shared/src/types/</code>"</>],
            ["Barrel Exports", "Every types/ file has a corresponding index.ts barrel export"],
            ["Discriminant Field", <>"Named <code>type</code> for results, <code>mode</code> for FlowState"</>],
            ["Discriminant Literal", <>"Use <code>typeof MyEnum.X</code> for type-safe discriminant literals"</>],
            ["Immutability", "Immutable fields use <code>readonly</code>; mutable fields are clearly documented"],
            ["Enums", "Use <code>export enum</code> for finite value sets (TaskState, PipelineResultType, etc.)"],
            ["Branded Types", "Use <code>string & {\_\_brand: \"X\"}</code> for nominal typing on primitives"],
            ["Enum vs Type Export", <>"<code>export</code> for enums (runtime), <code>export type</code> for types (compile-time)"</>],
            ["Optional Fields", <>"Mark truly optional fields with <code>?</code>; never use <code>| undefined</code> when optional"</>],
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
