import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ── Builder API ── */}
      <Section title="PipelineBuilder API">
        <ComparisonTable
          headers={["方法", "描述", "示例"]}
          rows={[
            [<Badge color="blue">source</Badge>, "PipelineInput → 首个 FlowState", <code>{`.source("collect-prompts", { runtime })`}</code>],
            [<Badge color="green">transform</Badge>, "FlowState → FlowState 转换", <code>{`.transform("stream-llm", { sm })`}</code>],
            [<Badge color="orange">boundary</Badge>, "任意 FlowState → 可能转为 ReadyToFinalize", <code>{`.boundary("check-follow-up")`}</code>],
            [<Badge color="red">sink</Badge>, "ReadyToFinalize → PipelineResult", <code>{`.sink("finalize", { runtime })`}</code>],
            [<Badge color="purple">build</Badge>, "构建 Pipeline；校验并解析 Element", <code>{`.build()`}</code>],
          ]}
        />

        <CodeBlock lang="typescript" code={`// packages/core/src/pipeline/builder.ts

export function pipeline(name: string): PipelineBuilder;

class PipelineBuilder {
  // Register a source element (converts PipelineInput → first FlowState)
  source(elementName: string, deps?: ElementDeps): this;

  // Register a transform element (FlowState → FlowState)
  transform(elementName: string, deps?: ElementDeps): this;

  // Register a boundary element (any FlowState → may transition to ReadyToFinalize)
  boundary(elementName: string, deps?: ElementDeps): this;

  // Register a sink element (ReadyToFinalize → PipelineResult)
  sink(elementName: string, deps?: ElementDeps): this;

  // Build the pipeline. Resolves all element names to constructors.
  // Throws if any element name is not registered.
  build(): Pipeline;
}

type ElementDeps = Record<string, unknown>;`} />
      </Section>

      {/* ── v1 vs v2 Comparison ── */}
      <Section title="v1 vs v2 对比">
        <div className="cmp" style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 300px" }}>
            <h4 style={{ marginBottom: "8px" }}>v1 — 硬编码</h4>
            <CodeBlock lang="typescript" code={`return {
  elements: [
    new CollectPrompts({ ctx, runtime }),
    new FormatMessages({
      ctx, runtime, transportConfig,
    }),
    new StreamLLM(ctx, serviceManager),
    // ... 7 more hardcoded elements
  ],
};`} />
          </div>
          <div style={{ flex: "1 1 300px" }}>
            <h4 style={{ marginBottom: "8px" }}>v2 — 声明式 Builder <Badge color="green">NEW</Badge></h4>
            <CodeBlock lang="typescript" code={`pipeline("conversation")
  .source("collect-prompts", { runtime })
  .transform("format-messages", { runtime, config })
  .transform("stream-llm", { serviceManager, tools, bus })  // streamText + tool calling
  .boundary("check-follow-up")  // parse follow_up IntentRequest
  .sink("finalize", { runtime })
  .build();`} />
          </div>
        </div>
        <Callout type="tip" title="v2 优势">
          <ul>
            <li><strong>命名解析</strong> — 按名称查找 Element 构造函数，支持热重载</li>
            <li><strong>声明式链</strong> — 显式表达 source → transform → boundary → sink 结构</li>
            <li><strong>运行时校验</strong> — build() 时验证 pipeline 结构和 Element 注册状态</li>
            <li><strong>依赖注入</strong> — 每个 Element 显式接收 deps，无全局状态</li>
          </ul>
        </Callout>
      </Section>

      {/* ── Element Registry ── */}
      <Section title="Element 注册表">
        <CodeBlock lang="typescript" code={`// packages/core/src/pipeline/registry.ts

import type { BaseElement } from "@atom-neo/shared/pipeline";

export type ElementConstructor = new (
  params: Record<string, unknown>
) => BaseElement;

const elementRegistry = new Map<string, ElementConstructor>();

export function registerElement(
  name: string,
  ctor: ElementConstructor,
): void {
  if (elementRegistry.has(name)) {
    throw new Error(\`Element "\${name}" is already registered\`);
  }
  elementRegistry.set(name, ctor);
}

export function resolveElement(name: string): ElementConstructor {
  const ctor = elementRegistry.get(name);
  if (!ctor) {
    throw new Error(
      \`Element "\${name}" not found. \`
      + \`Registered: [\${[...elementRegistry.keys()].join(", ")}]\`
    );
  }
  return ctor;
}

export function getRegisteredElementNames(): string[] {
  return [...elementRegistry.keys()];
}`} />
      </Section>

      {/* ── Element Registration Flow ── */}
      <Section title="Element 注册步骤">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {[
            { step: "1", title: "定义 Element 类", desc: "扩展 BaseElement，实现 doProcess()", color: "blue" },
            { step: "2", title: "注册 Element", desc: <code>registerElement("collect-prompts", CollectPromptsElement)</code>, color: "purple" },
            { step: "3", title: "在 PipelineBuilder 中引用", desc: <code>.source("collect-prompts", {"{"}runtime{"}"})</code>, color: "green" },
            { step: "4", title: "build() 时解析", desc: "按名称查找构造函数 → 实例化 → 加入 Element 链", color: "orange" },
          ].map((s, idx, arr) => (
            <div key={s.step} style={{ display: "flex", alignItems: "stretch", gap: "0" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "40px" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: `var(--color-${s.color}, #6366f1)`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px" }}>{s.step}</div>
                {idx < arr.length - 1 && <div style={{ width: "2px", flex: 1, background: "var(--color-border, #334155)", minHeight: "20px" }} />}
              </div>
              <div style={{ padding: "4px 12px 12px 12px" }}>
                <div style={{ fontWeight: 600, fontSize: "14px" }}>{s.title}</div>
                <div style={{ fontSize: "13px", color: "var(--color-muted, #6b7280)", marginTop: "4px" }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Pipeline Result Type ── */}
      <Section title="Pipeline 类型定义">
        <CodeBlock lang="typescript" code={`// packages/shared/src/pipeline/types.ts

export type Pipeline<I = any, O = any> = {
  /** Human-readable name for debugging */
  name: string;
  /** Ordered element chain */
  elements: Array<BaseElement>;
};

export type PipelineDefinition<TInput, TOutput> = {
  name: string;
  createInput(task: TaskItem, deps: PipelineRunDeps): TInput;
  createPipeline(
    deps: PipelineRunDeps,
    bus: PipelineEventBus,
    task: TaskItem,
  ): Pipeline<TInput, TOutput>;
  setup?(
    bus: PipelineEventBus,
    input: TInput,
    deps: PipelineRunDeps,
  ): void | (() => void);
};`} />
      </Section>

      {/* ── PipelineManager ── */}
      <Section title="PipelineManager">
        <CodeBlock lang="typescript" code={`// packages/core/src/pipeline/manager.ts

export class PipelineManager {
  #pipelines = new Map<string, Pipeline>();
  #builders = new Map<string, () => Pipeline>();

  // Register a pipeline builder function
  register(name: string, builder: () => Pipeline): void {
    if (this.#builders.has(name)) {
      throw new Error(\`Pipeline "\${name}" already registered\`);
    }
    this.#builders.set(name, builder);
  }

  // Get or build a pipeline instance
  get(name: string): Pipeline {
    if (!this.#pipelines.has(name)) {
      const builder = this.#builders.get(name);
      if (!builder) {
        throw new Error(
          \`Pipeline "\${name}" not found. \`
          + \`Registered: \${[...this.#builders.keys()]}\`
        );
      }
      this.#pipelines.set(name, builder());
    }
    return this.#pipelines.get(name)!;
  }

  // Hot-reload: rebuild a pipeline
  reload(name: string): Pipeline {
    const builder = this.#builders.get(name);
    if (!builder) throw new Error(\`Pipeline "\${name}" not found\`);
    const pipeline = builder();
    this.#pipelines.set(name, pipeline);
    return pipeline;
  }
}`} />
      </Section>

      {/* ── Builder Validation ── */}
      <Section title="Builder 校验规则">
        <Callout type="warn" title="build() 时自动校验">
          以下规则在 <code>build()</code> 调用时强制执行，失败抛出异常：
        </Callout>
        <ComparisonTable
          headers={["规则", "描述"]}
          rows={[
            ["1. 首个 Element", <strong>必须是 <Badge color="blue">source</Badge></strong>],
            ["2. 末尾 Element", <strong>必须是 <Badge color="red">sink</Badge></strong>],
            ["3. 中间 Element", <strong>必须是 <Badge color="green">transform</Badge> 或 <Badge color="orange">boundary</Badge></strong>],
            ["4. 名称唯一性", "同一 pipeline 内 Element 名称不得重复"],
            ["5. 注册检查", "所有 Element 名称必须在 elementRegistry 中已注册"],
          ]}
        />
        <CodeBlock lang="typescript" code={`class PipelineBuilder {
  build(): Pipeline {
    if (this.#elements.length === 0) {
      throw new Error("Pipeline must have at least one element");
    }

    const first = this.#elements[0];
    if (first.kind !== "source") {
      throw new Error(
        \`Pipeline must start with source element, got \${first.kind}\`
      );
    }

    const last = this.#elements[this.#elements.length - 1];
    if (last.kind !== "sink") {
      throw new Error(
        \`Pipeline must end with sink element, got \${last.kind}\`
      );
    }

    const names = new Set<string>();
    for (const el of this.#elements) {
      if (names.has(el.name)) {
        throw new Error(\`Duplicate element name "\${el.name}"\`);
      }
      names.add(el.name);
    }

    return {
      name: this.#name,
      elements: this.#elements,
    };
  }
}`} />
      </Section>

      {/* ── Adding a New Pipeline ── */}
      <Section title="添加新 Pipeline（七步法）">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {[
            { step: "1", title: "创建目录", desc: <code>packages/core/src/pipelines/{"<name>"}/</code>, color: "blue" },
            { step: "2", title: "定义 types.ts", desc: "Mode enum + FlowState 判别联合", color: "purple" },
            { step: "3", title: "定义 elements/", desc: "每个 Element 一个文件", color: "purple" },
            { step: "4", title: "注册所有 Element", desc: "在 bootstrap 函数中注册", color: "green" },
            { step: "5", title: "定义 Pipeline Builder", desc: "在 index.ts 中组装", color: "green" },
            { step: "6", title: "注册 Pipeline", desc: "通过 PipelineManager.register()", color: "orange" },
            { step: "7", title: "编写测试", desc: "测试完整 pipeline 流程", color: "red" },
          ].map((s, idx, arr) => (
            <div key={s.step} style={{ display: "flex", alignItems: "stretch", gap: "0" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "40px" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: `var(--color-${s.color}, #6366f1)`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px" }}>{s.step}</div>
                {idx < arr.length - 1 && <div style={{ width: "2px", flex: 1, background: "var(--color-border, #334155)", minHeight: "20px" }} />}
              </div>
              <div style={{ padding: "4px 12px 12px 12px" }}>
                <div style={{ fontWeight: 600, fontSize: "14px" }}>{s.title}</div>
                <div style={{ fontSize: "13px", color: "var(--color-muted, #6b7280)", marginTop: "4px" }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Full Pipeline Example ── */}
      <Section title="完整 Pipeline 示例">
        <CodeBlock lang="typescript" code={`// packages/core/src/pipelines/conversation.ts

import { pipeline } from "../pipeline/builder";
import { registerElement } from "../pipeline/registry";

// During startup, register all elements:
registerElement("collect-prompts", CollectPromptsElement);
registerElement("format-messages", FormatMessagesElement);
registerElement("stream-llm", StreamLLMElement);
registerElement("check-follow-up", CheckFollowUpElement);
registerElement("finalize", FinalizeConversationElement);

// Define the pipeline:
export const conversationPipeline = (
  deps: ConversationPipelineDeps,
) =>
  pipeline("conversation")
    .source("collect-prompts", { runtime: deps.runtime })
    .transform("format-messages", {
      runtime: deps.runtime,
      transportConfig: deps.transportConfig,
    })
    .transform("stream-llm", {
      serviceManager: deps.serviceManager,
      tools: deps.toolRegistry,
      bus: deps.bus,
    })
    .boundary("check-follow-up")
    .sink("finalize", { runtime: deps.runtime })
    .build();`} />
      </Section>
    </div>
  );
}
