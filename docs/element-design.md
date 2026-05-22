# Element Design Specification

> **Purpose**: How to design, implement, and register Pipeline Elements.
> Every Element MUST follow this specification.

---

## 1. Element Interface

```typescript
// src/src/packages/shared/src/pipeline/base-element.ts

export abstract class BaseElement<I = any, O = any> {
  readonly name: string;
  readonly kind: PipelineElementKind;
  protected readonly bus: PipelineEventBus<PipelineEventMap>;

  #state: "READY" | "WORKING" | "DONE" | "FAILED" = "READY";

  constructor(params: {
    name: string;
    kind: PipelineElementKind;
    bus: PipelineEventBus<PipelineEventMap>;
  }) {
    this.name = params.name;
    this.kind = params.kind;
    this.bus = params.bus;
    this.#reportState("READY");
  }

  // Template method: caller uses this, NOT doProcess
  async process(input: I): Promise<O> {
    this.#reportState("WORKING");
    try {
      const result = await this.doProcess(input);
      this.#reportState("DONE");
      return result;
    } catch (error) {
      this.#reportState("FAILED");
      throw error;
    }
  }

  // Subclass implements this
  protected abstract doProcess(input: I): Promise<O>;

  // Emit a data event to the pipeline bus
  protected report(eventName: string, payload: Record<string, unknown>): void {
    this.bus.emit(eventName, {
      name: this.name,
      payload,
    });
  }

  #reportState(state: string): void {
    this.#state = state;
    this.bus.emit("element.state-changed", {
      name: this.name,
      payload: { state },
    });
  }
}
```

**Key differences from v1:**
- Does NOT take `PipelineContext` as constructor parameter — inject only what you need
- Does NOT store `ctx` — if you need `task`, inject it explicitly
- Uses `bus` directly passed in, no wrapper

## 2. Element Kinds

```typescript
type PipelineElementKind = "source" | "transform" | "boundary" | "sink";

// source:   Converts pipeline input into the first FlowState.
//           Must not produce PipelineResult. May skip execution.
//
// transform: Converts one FlowState into another.
//            Must not produce PipelineResult. May pass through.
//
// boundary:  May convert ANY FlowState into ReadyToFinalize.
//            Decides finalization path but must not produce PipelineResult.
//
// sink:      ONLY accepts ReadyToFinalize. Produces PipelineResult.
//            Throws if input.mode is not ReadyToFinalize.
```

## 3. Element Construction

### 3.1 Constructor Pattern

```typescript
// EVERY Element follows this pattern:
export class MyElement extends BaseElement<InputType, OutputType> {
  // Private fields for dependencies, prefixed with #
  #runtime: Runtime;
  #config: MyElementConfig;

  // Constructor takes named params object
  constructor(params: {
    bus: PipelineEventBus<PipelineEventMap>;
    // Inject ONLY what this element needs.
    // NEVER inject a mega-object like "Runtime" just in case.
    runtime: Runtime;
    config: MyElementConfig;
  }) {
    super({
      name: "MyElement",       // human-readable, unique within pipeline
      kind: "transform",       // source | transform | boundary | sink
      bus: params.bus,
    });
    const { bus: _bus, ...deps } = params;
    Object.assign(this, deps);
  }
}
```

### 3.2 Dependency Injection Rules

| What to Inject | What NOT to Inject |
|---------------|-------------------|
| Specific Runtime method or small interface | Whole Runtime class |
| `bus: PipelineEventBus` | `PipelineContext` |
| `config: MyElementConfig` (typed) | `Record<string, unknown>` |
| `serviceManager` (if element needs service lookup) | `ServiceManager` + `Runtime` (pick one) |

## 4. doProcess Implementation

### 4.1 FlowState Mode Gate (MANDATORY for transform/boundary/sink)

```typescript
async doProcess(input: MyFlowState): Promise<MyFlowState> {
  // 1. ALWAYS gate on mode first
  if (input.mode !== ExpectedMode) {
    this.report("element.data", {
      event: "skipped",
      reason: "mode not expected",
      currentMode: input.mode,
    });
    return input;  // Pass through
  }

  // 2. Process

  // 3. Return NEW FlowState with updated mode
  return {
    mode: NextMode,
    // ... accumulated data
  } as MyFlowState;
}
```

### 4.2 Source Element Pattern

```typescript
// Source elements: PipelineInput → first FlowState variant
async doProcess(input: MyFlowState): Promise<MyFlowState> {
  if (input.mode !== PipelineInputMode) {
    return input;
  }

  // Optional: conditional skip
  if (shouldSkip(input)) {
    return {
      mode: DownstreamMode,
      state: input.state,
      // ... default values
    } as MyFlowState;
  }

  // Normal path: prepare for downstream
  const data = await this.#prepare(input);
  return {
    mode: NextMode,
    state: input.state,
    ...data,
  } as MyFlowState;
}
```

### 4.3 Transform Element Pattern

```typescript
async doProcess(input: MyFlowState): Promise<MyFlowState> {
  if (input.mode !== ExpectedMode) {
    return input;
  }

  const result = await this.#process(input);

  return {
    ...input,         // Carry forward accumulated data
    mode: NextMode,
    // ... new fields from result
  } as MyFlowState;
}
```

### 4.4 Boundary Element Pattern

```typescript
async doProcess(input: MyFlowState): Promise<MyFlowState> {
  if (input.mode !== ExpectedMode) {
    return input;
  }

  // Decision: should finalize?
  if (shouldFinalize(input)) {
    return {
      mode: ReadyToFinalize,
      finalization: {
        type: PipelineResultType.Enqueue,
        transition: PipelineEnqueueTransition.FollowUp,
        nextTask: createNextTask(input),
        // ... extra fields needed by finalization
      },
    } as MyFlowState;
  }

  // Not ready to finalize — pass through
  return input;
}
```

### 4.5 Sink Element Pattern

```typescript
async doProcess(input: MyFlowState): Promise<PipelineResult> {
  // ALWAYS assert ready_to_finalize
  if (input.mode !== ReadyToFinalize) {
    throw new Error(`Pipeline ${this.name} did not reach finalize state`);
  }

  // Read finalization type and construct PipelineResult
  if (input.finalization.type === PipelineResultType.Enqueue) {
    return {
      type: PipelineResultType.Enqueue,
      transition: input.finalization.transition,
      task: this.#task,
      nextTask: input.finalization.nextTask,
    };
  }

  // Default: complete
  return {
    type: PipelineResultType.Complete,
    task: this.#task,
  };
}
```

## 5. Element Registration

```typescript
// src/packages/core/src/pipeline/registry.ts

import type { BaseElement } from "@atom-neo/shared/pipeline";

type ElementConstructor = new (params: Record<string, unknown>) => BaseElement;

const elementRegistry = new Map<string, ElementConstructor>();

export function registerElement(name: string, ctor: ElementConstructor): void {
  if (elementRegistry.has(name)) {
    throw new Error(`Element "${name}" already registered`);
  }
  elementRegistry.set(name, ctor);
}

export function resolveElement(name: string): ElementConstructor {
  const ctor = elementRegistry.get(name);
  if (!ctor) throw new Error(`Element "${name}" not found in registry`);
  return ctor;
}
```

## 6. Element Template (Copy-Paste)

```typescript
/**
 * MyElement — short description of what this element does.
 *
 * Gates on <ExpectedMode>, does <what>, transitions to <NextMode>.
 *
 * kind: <source|transform|boundary|sink>
 */
import { BaseElement } from "@atom-neo/shared/pipeline";
import type { PipelineEventBus, PipelineEventMap } from "@atom-neo/shared/pipeline";
import type { MyFlowState, MyMode } from "../types";

export class MyElement extends BaseElement<MyFlowState, MyFlowState> {
  // Private dependencies
  #myDep: MyDependency;

  constructor(params: {
    bus: PipelineEventBus<PipelineEventMap>;
    myDep: MyDependency;
  }) {
    super({ name: "MyElement", kind: "transform", bus: params.bus });
    this.#myDep = params.myDep;
  }

  async doProcess(input: MyFlowState): Promise<MyFlowState> {
    // === Guard: mode check ===
    if (input.mode !== MyMode.ExpectedInputMode) {
      this.report("element.data", {
        event: "skipped",
        reason: "mode mismatch",
        currentMode: input.mode,
      });
      return input;
    }

    // === Process ===
    const result = await this.#myDep.doSomething(input);

    this.report("element.data", {
      event: "processed",
      someData: result.count,
    });

    // === Transition ===
    return {
      ...input,
      mode: MyMode.NextOutputMode,
      newField: result.data,
    } as MyFlowState;
  }
}
```

## 7. Conversation Pipeline — 新增 Element

### 7.1 `load-system-prompt` — 安全提示词

```typescript
import baseSystemPrompt from "../assets/prompts/base_system_prompt.md";

class LoadSystemPromptElement extends BaseElement<MyFlowState, MyFlowState> {
  async doProcess(input: MyFlowState): Promise<MyFlowState> {
    if (input.mode !== "streaming") return input;
    return { ...input, systemPrompt: baseSystemPrompt };
  }
}
```

**关键**: Bun 原生支持 `import ... from "*.md"`，打包为二进制时内联为字符串。

### 7.2 `collect-context` — 上下文元数据

```typescript
class CollectContextElement extends BaseElement<MyFlowState, MyFlowState> {
  async doProcess(input: MyFlowState): Promise<MyFlowState> {
    if (input.mode !== "streaming") return input;
    const ctx = [
      `Current Time: ${new Date().toISOString()}`,
      `Working Directory: ${process.cwd()}`,
    ].join("\n");
    return { ...input, contextData: ctx };
  }
}
```

### 7.3 `format-messages` — 消息组装

```typescript
class FormatMessagesElement extends BaseElement<MyFlowState, MyFlowState> {
  async doProcess(input: MyFlowState): Promise<MyFlowState> {
    if (input.mode !== "streaming") return input;

    const messages: Message[] = [];
    if (input.systemPrompt) messages.push({ role: "system", content: input.systemPrompt });
    if (input.contextData) messages.push({ role: "system", content: input.contextData });
    for (const m of input.prompts ?? []) messages.push({ role: m.role, content: m.content });

    return { ...input, mode: "formatted", messages };
  }
}
```

## 8. StreamLLM — streamText + Tool Calling Pattern

```typescript
/**
 * StreamLLM — 流式 LLM 调用 + 工具执行。
 *
 * Gates on "streaming" mode.
 * streamText 输出 deltas 到 bus，工具调用通过 AI SDK tools 参数自动处理。
 *
 * kind: transform
 */
export class StreamLLMElement extends BaseElement<MyFlowState, MyFlowState> {
  #tools: ToolDefinition[];
  #serviceManager: ServiceManager;

  constructor(params: {
    bus: PipelineEventBus<FullEventMap>;
    tools: ToolDefinition[];
    serviceManager: ServiceManager;
  }) {
    super({ name: "StreamLLM", kind: "transform", bus: params.bus });
    this.#tools = params.tools;
    this.#serviceManager = params.serviceManager;
  }

  async doProcess(input: MyFlowState): Promise<MyFlowState> {
    if (input.mode !== "streaming") return input;

    const result = await streamText({
      model: this.#serviceManager.getModel(),
      messages: input.prompts,
      tools: convertToAISDKTools(this.#tools),
      onChunk({ chunk }) {
        if (chunk.type === "text-delta") {
          this.bus.emit("transport.delta", { textDelta: chunk.textDelta });
        }
      },
      onFinish({ response }) {
        this.bus.emit("transport.tool.finished", { /* ... */ });
      },
    });

    return {
      ...input,
      mode: "executing",
      responseText: result.text,
    } as MyFlowState;
  }
}
```

## 8. Testing Elements

```typescript
// Tests MUST verify:
// 1. Mode gating (pass-through on wrong mode)
// 2. Correct processing on matching mode
// 3. Correct mode transition
// 4. Event emissions via bus spy

test("passes through when mode is not ExpectedInputMode", async () => {
  const bus = new PipelineEventBus<TestEventMap>();
  const element = new MyElement({ bus, myDep: mockDep });
  const input = { mode: WrongMode, ... } as MyFlowState;

  const result = await element.process(input);

  expect(result).toBe(input);   // Same reference — passthrough
});

test("processes and transitions on matching mode", async () => {
  const bus = new PipelineEventBus<TestEventMap>();
  const element = new MyElement({ bus, myDep: mockDep });
  const input = { mode: MyMode.ExpectedInputMode, ... } as MyFlowState;

  const result = await element.process(input);

  expect(result.mode).toBe(MyMode.NextOutputMode);
  expect(result.newField).toBe(expectedData);
});
```
