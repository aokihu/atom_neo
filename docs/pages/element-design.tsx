import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge, parseInline } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ── Callout: Key differences from v1 ── */}
      <Callout type="warn" title="Key differences from v1">
        <strong>v1:</strong> Elements inherited from <code>//BasePipelineElement//</code>, had a <code>process()</code> method returning <code>PipelineResult</code>, and were hardcoded with <code>new Element()</code>.
        <br />
        <strong>v2:</strong> Elements implement <code>BaseElement</code> with <code>doProcess(input: &lt;TIn&gt;): Promise&lt;TOut&gt;</code>, use a <strong>mode gate</strong> via <code>FlowState</code>, are constructed via DI, and are registered by name for PipelineBuilder DSL usage.
      </Callout>

      {/* ── Section 1: Element Interface ── */}
      <Section title="1. Element Interface">
        <p>
          Every pipeline element extends <code>BaseElement</code>. The abstract method <code>doProcess</code> is the
          single integration point — input/output typing is enforced at the class level.
        </p>
        <CodeBlock lang="typescript" code={`import { FlowState, PipelineResult } from "../FlowState";

export type PipelineElementKind = "source" | "transform" | "boundary" | "sink";

export abstract class BaseElement<TIn = FlowState, TOut = FlowState> {
  abstract readonly kind: PipelineElementKind;
  abstract readonly name: string;

  // DI constructor: inject only what this element needs
  constructor(protected readonly deps: Record<string, unknown>) {}

  // Single integration point — subclasses implement this
  abstract doProcess(input: TIn): Promise<TOut>;

  // Mode gate: throws if FlowState.mode doesn't match expected
  protected assertMode(state: FlowState, expected: string): void {
    if (state.mode !== expected) {
      throw new Error(
        \`[\${this.name}] Expected mode "\${expected}", got "\${state.mode}"\`
      );
    }
  }
}`} />
      </Section>

      {/* ── Section 2: Element Kinds ── */}
      <Section title="2. Element Kinds">
        <p>
          Every element declares its <code>kind</code> — this determines its position in the pipeline,
          its input/output contracts, and its permissions.
        </p>
        <ComparisonTable
          headers={["Kind", "Role", "Constraints"]}
          rows={[
            [
              <code>source</code>,
              "Converts pipeline input into first FlowState",
              "Must NOT produce PipelineResult",
            ],
            [
              <code>transform</code>,
              "Converts one FlowState into another",
              "Must NOT produce PipelineResult",
            ],
            [
              <code>boundary</code>,
              "May convert ANY FlowState into ReadyToFinalize",
              "Decides finalization path",
            ],
            [
              <code>sink</code>,
              "ONLY accepts ReadyToFinalize",
              "Produces PipelineResult; throws on wrong mode",
            ],
          ]}
        />
      </Section>

      {/* ── Section 3: Element Construction ── */}
      <Section title="3. Element Construction">

        {/* 3.1 Constructor Pattern */}
        <h3>3.1 Constructor Pattern</h3>
        <p>
          Elements receive dependencies through the constructor. The <code>deps</code> object is typed
          per-element — only inject what the element actually needs. No global registry, no service locator.
        </p>
        <CodeBlock lang="typescript" code={`// Source: receives pipeline input (not FlowState)
export class CollectPrompts extends BaseElement<TaskInput, FlowState> {
  readonly kind = "source";
  readonly name = "collect-prompts";

  constructor(deps: { runtime: Runtime; config: PipelineConfig }) {
    super(deps);
  }

  async doProcess(input: TaskInput): Promise<FlowState> {
    // convert TaskInput → first FlowState
  }
}

// Transform: FlowState → FlowState
export class FormatMessages extends BaseElement<FlowState, FlowState> {
  readonly kind = "transform";
  readonly name = "transform-to-payload";

  constructor(deps: { runtime: Runtime; transportConfig: TransportConfig }) {
    super(deps);
  }

  async doProcess(state: FlowState): Promise<FlowState> {
    this.assertMode(state, "streaming");
    // mutate and return FlowState
  }
}

// Boundary: decides finalization (follow_up IntentRequest)
export class CheckFollowUp extends BaseElement<FlowState, FlowState> {
  readonly kind = "boundary";
  readonly name = "check-follow-up";

  constructor(deps: { runtime: Runtime }) {
    super(deps);
  }

  async doProcess(state: FlowState): Promise<FlowState> {
    // may set state.mode = "readyToFinalize"
    return state;
  }
}

// Sink: ReadyToFinalize → PipelineResult
export class Finalize extends BaseElement<FlowState, PipelineResult> {
  readonly kind = "sink";
  readonly name = "finalize";

  constructor(deps: { runtime: Runtime }) {
    super(deps);
  }

  async doProcess(state: FlowState): Promise<PipelineResult> {
    this.assertMode(state, "readyToFinalize");
    // produce final PipelineResult
  }
}`} />

        {/* 3.2 Dependency Injection Rules */}
        <h3>3.2 Dependency Injection Rules</h3>
        <ComparisonTable
          headers={["What to Inject", "What NOT to Inject"]}
          rows={[
            [
              <><code>Runtime</code> — per-pipeline runtime config</>,
              <>
                <code>ServiceManager</code> or any global singleton — prefer
                per-instance injection
              </>,
            ],
            [
              <><code>ToolRegistry</code> — the tool catalog for tool-calling elements</>,
              <>
                <code>PipelineEventBus</code> directly — emit events through the
                pipeline runner, not the bus
              </>,
            ],
            [
              <><code>SessionContext</code> — per-session state</>,
              <>
                Raw <code>config.json</code> objects — use typed config classes
              </>,
            ],
            [
              <><>Typed config objects (<code>TransportConfig</code>,{" "}<code>PipelineConfig</code>)</></>,
              <><code>LLM</code> model instances — inject through ToolRegistry or Runtime</>,
            ],
          ]}
        />
      </Section>

      {/* ── Section 4: doProcess Implementation ── */}
      <Section title="4. doProcess Implementation">

        {/* 4.1 FlowState Mode Gate */}
        <h3>4.1 FlowState Mode Gate</h3>
        <p>
          Each element uses an <strong>assertMode</strong> guard at the top of <code>doProcess</code>.
          This is the contract enforcement mechanism — if the incoming <code>FlowState.mode</code> is not
          what the element expects, it throws immediately.
        </p>
        <CodeBlock lang="typescript" code={`// BaseElement provides this helper
protected assertMode(state: FlowState, expected: string): void {
  if (state.mode !== expected) {
    throw new Error(
      \`[\${this.name}] Expected mode "\${expected}", got "\${state.mode}"\`
    );
  }
}

// FlowState mode transitions across the pipeline:
//   "initial" → "streaming" → "readyToFinalize" → (PipelineResult)`} />

        {/* 4.2 Source Element */}
        <h3>4.2 Source Element</h3>
        <p>
          A <strong>source</strong> is the pipeline entry point. It converts raw pipeline input
          (e.g., <code>TaskInput</code>) into the first <code>FlowState</code> with{" "}
          <code>mode = "initial"</code>.
        </p>
        <CodeBlock lang="typescript" code={`export class CollectPrompts extends BaseElement<TaskInput, FlowState> {
  readonly kind = "source";
  readonly name = "collect-prompts";

  constructor(deps: { runtime: Runtime }) {
    super(deps);
  }

  async doProcess(input: TaskInput): Promise<FlowState> {
    const { runtime } = this.deps;

    const state: FlowState = {
      mode: "initial",
      sessionId: input.sessionId,
      messages: input.messages,
      inferenceContext: {
        hiddenFacts: [],
      },
    };

    return state;
  }
}`} />

        {/* 4.3 Transform Element */}
        <h3>4.3 Transform Element</h3>
        <p>
          A <strong>transform</strong> reads and mutates a <code>FlowState</code>. It must not produce
          a <code>PipelineResult</code> — it only advances the FlowState through intermediate modes.
        </p>
        <CodeBlock lang="typescript" code={`export class FormatMessages extends BaseElement<FlowState, FlowState> {
  readonly kind = "transform";
  readonly name = "transform-to-payload";

  constructor(deps: { runtime: Runtime; transportConfig: TransportConfig }) {
    super(deps);
  }

  async doProcess(state: FlowState): Promise<FlowState> {
    this.assertMode(state, "initial");

    const { runtime, transportConfig } = this.deps;

    state.payload = {
      model: transportConfig.model,
      messages: state.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    state.mode = "streaming";
    return state;
  }
}`} />

        {/* 4.4 Boundary Element */}
        <h3>4.4 Boundary Element</h3>
        <p>
          A <strong>boundary</strong> is the decision point. It inspects the current FlowState and either
          advances it toward finalization (<code>mode = "readyToFinalize"</code>) or loops back for
          further processing.
        </p>
        <CodeBlock lang="typescript" code={`export class CheckFollowUp extends BaseElement<FlowState, FlowState> {
  readonly kind = "boundary";
  readonly name = "check-follow-up";

  constructor(deps: { runtime: Runtime }) {
    super(deps);
  }

  async doProcess(state: FlowState): Promise<FlowState> {
    this.assertMode(state, "executing");

    const intents = parseIntentRequests(state.responseText);

    if (intents.length === 0) {
      state.mode = "readyToFinalize";
      return state;
    }

    // Has intents to execute — stay in streaming mode
    state.pendingIntents = intents;
    return state;
  }
}`} />

        {/* 4.5 Sink Element */}
        <h3>4.5 Sink Element</h3>
        <p>
          A <strong>sink</strong> is the terminal element. It only accepts{" "}
          <code>mode = "readyToFinalize"</code> and produces the final <code>PipelineResult</code>.
          If it receives any other mode, <code>assertMode</code> throws.
        </p>
        <CodeBlock lang="typescript" code={`export class Finalize extends BaseElement<FlowState, PipelineResult> {
  readonly kind = "sink";
  readonly name = "finalize";

  constructor(deps: { runtime: Runtime }) {
    super(deps);
  }

  async doProcess(state: FlowState): Promise<PipelineResult> {
    this.assertMode(state, "readyToFinalize");

    return {
      status: "completed",
      sessionId: state.sessionId,
      visibleText: state.visibleText ?? "",
      toolCalls: state.toolCalls ?? [],
      finalState: state,
    };
  }
}`} />
      </Section>

      {/* ── Section 5: Element Registration ── */}
      <Section title="5. Element Registration">
        <p>
          Elements are registered by name in the <code>ElementRegistry</code>. The PipelineBuilder
          looks up elements by name, so every element must be registered before any pipeline that
          references it is built.
        </p>
        <CodeBlock lang="typescript" code={`import { ElementRegistry } from "../ElementRegistry";

// Registry: name → constructor
const registry = new ElementRegistry();

// Register all elements at startup
registry.set("collect-prompts", (deps) => new CollectPrompts(deps));
registry.set("transform-to-payload", (deps) => new FormatMessages(deps));
registry.set("stream-llm", (deps) => new StreamLLM(deps));  // streamText + tool calling
registry.set("check-follow-up", (deps) => new CheckFollowUp(deps));       // follow_up IntentRequest
registry.set("finalize", (deps) => new Finalize(deps));

// PipelineBuilder usage:
//   pipeline("conversation")
//     .source("collect-prompts", { runtime })
//     .sink("finalize", { runtime })
//     .build();`} />
      </Section>

      {/* ── Section 6: Element Template ── */}
      <Section title="6. Element Template (Copy-Paste)">
        <p>
          Use this template when creating a new element. Replace <code>MyElement</code>, the{" "}
          <code>kind</code>, <code>name</code>, generic parameters, and <code>doProcess</code> body.
        </p>
        <CodeBlock lang="typescript" code={`import { BaseElement, FlowState, PipelineResult } from "../BaseElement";

// ── Template: copy, paste, fill in ──
export class MyElement extends BaseElement</* TIn */ FlowState, /* TOut */ FlowState> {
  readonly kind: PipelineElementKind = /* "source" | "transform" | "boundary" | "sink" */ "transform";
  readonly name = /* kebab-case, unique */ "my-element";

  constructor(deps: {
    // Inject ONLY what this element needs
    runtime: Runtime;
    // toolRegistry?: ToolRegistry;
    // config?: MyConfig;
  }) {
    super(deps);
  }

  async doProcess(input: /* TIn */ FlowState): Promise</* TOut */ FlowState> {
    // 1. Mode gate — always first
    this.assertMode(input, "expected-mode");

    // 2. Read deps
    const { runtime } = this.deps;

    // 3. Transform logic
    // input.foo = ...;

    // 4. Advance mode
    input.mode = "next-mode";

    return input;
  }
}

// ── Registration ──
// registry.set("my-element", (deps) => new MyElement(deps));`} />
      </Section>

      {/* ── Section 7: Testing Elements ── */}
      <Section title="7. Testing Elements">
        <p>
          Elements are unit-testable in isolation. Mock dependencies, construct the element directly,
          and assert on the returned state.
        </p>
        <CodeBlock lang="typescript" code={`import { describe, it, expect } from "vitest";
import { CollectPrompts } from "../CollectPrompts";
import { FormatMessages } from "../FormatMessages";
import { Finalize } from "../Finalize";

describe("CollectPrompts (source)", () => {
  it("converts TaskInput into FlowState with mode=initial", async () => {
    const runtime = { pipelines: {}, config: {} } as Runtime;
    const element = new CollectPrompts({ runtime });

    const result = await element.doProcess({
      sessionId: "s1",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.mode).toBe("initial");
    expect(result.sessionId).toBe("s1");
    expect(result.messages).toHaveLength(1);
  });
});

describe("FormatMessages (transform)", () => {
  it("mutates FlowState and advances mode", async () => {
    const element = new FormatMessages({
      runtime: {} as Runtime,
      transportConfig: { model: "gpt-4" } as TransportConfig,
    });

    const state: FlowState = {
      mode: "initial",
      sessionId: "s1",
      messages: [{ role: "user", content: "hi" }],
      inferenceContext: { hiddenFacts: [] },
    };

    const result = await element.doProcess(state);

    expect(result.mode).toBe("streaming");
    expect(result.payload).toBeDefined();
    expect(result.payload!.model).toBe("gpt-4");
  });

  it("throws on wrong mode", async () => {
    const element = new FormatMessages({
      runtime: {} as Runtime,
      transportConfig: { model: "gpt-4" } as TransportConfig,
    });

    await expect(
      element.doProcess({ mode: "streaming" } as FlowState)
    ).rejects.toThrow(/Expected mode "initial"/);
  });
});

describe("Finalize (sink)", () => {
  it("produces PipelineResult from readyToFinalize", async () => {
    const element = new Finalize({ runtime: {} as Runtime });

    const state: FlowState = {
      mode: "readyToFinalize",
      sessionId: "s1",
      messages: [],
      inferenceContext: { hiddenFacts: [] },
      visibleText: "Done.",
      toolCalls: [],
    };

    const result = await element.doProcess(state);

    expect(result.status).toBe("completed");
    expect(result.visibleText).toBe("Done.");
  });

  it("throws if mode is not readyToFinalize", async () => {
    const element = new Finalize({ runtime: {} as Runtime });

    await expect(
      element.doProcess({ mode: "streaming" } as FlowState)
    ).rejects.toThrow(/Expected mode "readyToFinalize"/);
  });
});`} />
      </Section>

    </div>
  );
}
