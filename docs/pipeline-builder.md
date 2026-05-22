# Pipeline Builder DSL

> **Purpose**: Specification for the declarative pipeline construction API.
> Replaces v1's hardcoded `new Element()` pattern with named element resolution.

---

## 1. API

```typescript
// src/packages/core/src/pipeline/builder.ts

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

type ElementDeps = Record<string, unknown>;
```

## 2. Usage Example

```typescript
// src/packages/core/src/pipelines/conversation.ts

import { pipeline } from "../pipeline/builder";
import { registerElement } from "../pipeline/registry";

// During startup, register all elements:
registerElement("collect-prompts", CollectPromptsElement);
registerElement("format-messages", FormatMessagesElement);
registerElement("stream-llm", StreamLLMElement);  // streamText + tool calling
registerElement("check-follow-up", CheckFollowUpElement);       // parse follow_up IntentRequest
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
    .build();
```

## 3. Element Registry

```typescript
// src/packages/core/src/pipeline/registry.ts

import type { BaseElement } from "@atom-neo/shared/pipeline";

export type ElementConstructor = new (params: Record<string, unknown>) => BaseElement;

const elementRegistry = new Map<string, ElementConstructor>();

export function registerElement(name: string, ctor: ElementConstructor): void {
  if (elementRegistry.has(name)) {
    throw new Error(`Element "${name}" is already registered`);
  }
  elementRegistry.set(name, ctor);
}

export function resolveElement(name: string): ElementConstructor {
  const ctor = elementRegistry.get(name);
  if (!ctor) {
    throw new Error(
      `Element "${name}" not found. Registered: [${[...elementRegistry.keys()].join(", ")}]`
    );
  }
  return ctor;
}

export function getRegisteredElementNames(): string[] {
  return [...elementRegistry.keys()];
}
```

## 4. Pipeline Result Type

```typescript
// src/src/packages/shared/src/pipeline/types.ts

export type Pipeline<I = any, O = any> = {
  /** Human-readable name for debugging */
  name: string;
  /** Ordered element chain */
  elements: Array<BaseElement>;
};

export type PipelineDefinition<TInput, TOutput> = {
  name: string;
  createInput(task: TaskItem, deps: PipelineRunDeps): TInput;
  createPipeline(deps: PipelineRunDeps, bus: PipelineEventBus, task: TaskItem): Pipeline<TInput, TOutput>;
  setup?(bus: PipelineEventBus, input: TInput, deps: PipelineRunDeps): void | (() => void);
};
```

## 5. Runtime Pipeline Registration

```typescript
// src/packages/core/src/pipeline/manager.ts

export class PipelineManager {
  #pipelines = new Map<string, Pipeline>();
  #builders = new Map<string, () => Pipeline>();

  // Register a pipeline builder function
  register(name: string, builder: () => Pipeline): void {
    if (this.#builders.has(name)) {
      throw new Error(`Pipeline "${name}" already registered`);
    }
    this.#builders.set(name, builder);
  }

  // Get or build a pipeline instance
  get(name: string): Pipeline {
    if (!this.#pipelines.has(name)) {
      const builder = this.#builders.get(name);
      if (!builder) {
        throw new Error(`Pipeline "${name}" not found. Registered: ${[...this.#builders.keys()]}`);
      }
      this.#pipelines.set(name, builder());
    }
    return this.#pipelines.get(name)!;
  }

  // Hot-reload: rebuild a pipeline
  reload(name: string): Pipeline {
    const builder = this.#builders.get(name);
    if (!builder) throw new Error(`Pipeline "${name}" not found`);
    const pipeline = builder();
    this.#pipelines.set(name, pipeline);
    return pipeline;
  }
}
```

## 6. Builder Validation

```typescript
// Builder validates at build() time:
// 1. First element MUST be "source" kind
// 2. Last element MUST be "sink" kind
// 3. Middle elements MUST be "transform" or "boundary" kind
// 4. No duplicate element names within a pipeline
// 5. All element names MUST be registered

class PipelineBuilder {
  build(): Pipeline {
    if (this.#elements.length === 0) {
      throw new Error("Pipeline must have at least one element");
    }

    const first = this.#elements[0];
    if (first.kind !== "source") {
      throw new Error(`Pipeline must start with source element, got ${first.kind}`);
    }

    const last = this.#elements[this.#elements.length - 1];
    if (last.kind !== "sink") {
      throw new Error(`Pipeline must end with sink element, got ${last.kind}`);
    }

    const names = new Set<string>();
    for (const el of this.#elements) {
      if (names.has(el.name)) {
        throw new Error(`Duplicate element name "${el.name}"`);
      }
      names.add(el.name);
    }

    return {
      name: this.#name,
      elements: this.#elements,
    };
  }
}
```

## 7. Adding a New Pipeline

```text
1. Create src/packages/core/src/pipelines/<name>/
2. Define types.ts (Mode enum + FlowState discriminated union)
3. Define elements/ (one file per Element)
4. Register all elements in a bootstrap function
5. Define pipeline builder in index.ts
6. Register pipeline via PipelineManager
7. Write tests
```
