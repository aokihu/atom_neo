# Pipeline Development Guide

> **Purpose**: How to design Elements, build Pipelines, and use the Event Bus — the complete pipeline development reference.

---

# Part 1: Element Design

## 1. Element Interface

```typescript
export abstract class BaseElement<I = any, O = any> {
  readonly name: string;
  readonly kind: PipelineElementKind;
  protected readonly bus: PipelineEventBus<PipelineEventMap>;
  #state: "READY" | "WORKING" | "DONE" | "FAILED" = "READY";

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

  protected abstract doProcess(input: I): Promise<O>;

  protected report(eventName: string, payload: Record<string, unknown>): void {
    this.bus.emit(eventName, { name: this.name, payload });
  }
}
```

## 2. Element Kinds

| Kind | 职责 | 输入 | 输出 |
|------|------|------|------|
| `source` | PipelineInput → 第一个 FlowState | PipelineInput | FlowState |
| `transform` | FlowState → FlowState | FlowState | FlowState |
| `boundary` | 决策点，可能切换到 ready_to_finalize | FlowState | FlowState |
| `sink` | ready_to_finalize → PipelineResult | FlowState | PipelineResult |

## 3. Constructor Pattern

```typescript
export class MyElement extends BaseElement<InputType, OutputType> {
  #runtime: Runtime;

  constructor(params: {
    bus: PipelineEventBus<PipelineEventMap>;
    runtime: Runtime;   // Inject ONLY what this element needs
  }) {
    super({ name: "MyElement", kind: "transform", bus: params.bus });
    const { bus: _bus, ...deps } = params;
    Object.assign(this, deps);
  }
}
```

**注入原则**: 注入具体依赖，不注入巨型对象。`bus` + 具体字段，不传 `serviceManager` 或 `PipelineContext`。

## 4. Mode Gate (必写)

```typescript
async doProcess(input: MyFlowState): Promise<MyFlowState> {
  if (input.mode !== ExpectedMode) {
    this.report("element.data", { event: "skipped", reason: "mode mismatch" });
    return input;  // 透传
  }
  // ... 处理 ...
  return { ...input, mode: NextMode };
}
```

## 5. 各 Kind 实现模式

### Source

```typescript
async doProcess(input): Promise<MyFlowState> {
  if (input.mode !== PipelineInputMode) return input;
  if (shouldSkip(input)) return { mode: DownstreamMode, ...defaults };
  const data = await this.#prepare(input);
  return { mode: NextMode, ...data };
}
```

### Transform

```typescript
async doProcess(input: MyFlowState): Promise<MyFlowState> {
  if (input.mode !== ExpectedMode) return input;
  const result = await this.#process(input);
  return { ...input, mode: NextMode, newField: result.data };
}
```

### Boundary

```typescript
async doProcess(input: MyFlowState): Promise<MyFlowState> {
  if (input.mode !== ExpectedMode) return input;
  if (shouldFinalize(input)) {
    return {
      mode: ReadyToFinalize,
      finalization: { type: PipelineResultType.Enqueue, transition, nextTask },
    };
  }
  return input;  // 不满足 finalize 条件，透传
}
```

### Sink

```typescript
async doProcess(input: MyFlowState): Promise<PipelineResult> {
  if (input.mode !== ReadyToFinalize) {
    throw new Error("Pipeline did not reach finalize state");
  }
  return { type: PipelineResultType.Complete, task: this.#task };
}
```

## 6. Element 模板（Copy-Paste）

```typescript
/**
 * MyElement — short description.
 * Gates on <ExpectedMode>, does <what>, transitions to <NextMode>.
 * kind: transform
 */
export class MyElement extends BaseElement<MyFlowState, MyFlowState> {
  #myDep: MyDependency;

  constructor(params: { bus: PipelineEventBus<PipelineEventMap>; myDep: MyDependency }) {
    super({ name: "MyElement", kind: "transform", bus: params.bus });
    this.#myDep = params.myDep;
  }

  async doProcess(input: MyFlowState): Promise<MyFlowState> {
    if (input.mode !== MyMode.ExpectedInputMode) {
      this.report("element.data", { event: "skipped", reason: "mode mismatch" });
      return input;
    }
    const result = await this.#myDep.doSomething(input);
    this.report("element.data", { event: "processed", count: result.count });
    return { ...input, mode: MyMode.NextOutputMode, newField: result.data };
  }
}
```

## 7. 测试

```typescript
test("passes through on wrong mode", async () => {
  const element = new MyElement({ bus, myDep: mockDep });
  const result = await element.process({ mode: WrongMode });
  expect(result).toBe(input);
});

test("processes and transitions on matching mode", async () => {
  const result = await element.process({ mode: ExpectedMode, ...input });
  expect(result.mode).toBe(NextMode);
  expect(result.newField).toBe(expected);
});
```

---

# Part 2: Pipeline Builder

## 1. API

```typescript
export function pipeline(name: string): PipelineBuilder;

class PipelineBuilder {
  source(elementName: string, deps?: ElementDeps): this;
  transform(elementName: string, deps?: ElementDeps): this;
  boundary(elementName: string, deps?: ElementDeps): this;
  sink(elementName: string, deps?: ElementDeps): this;
  build(): Pipeline;
}
```

## 2. 使用示例

```typescript
export const conversationPipeline = (deps: ConversationPipelineDeps) =>
  pipeline("conversation")
    .source("collect-prompts", { session: deps.session })
    .transform("load-system-prompt", {})
    .transform("fetch-agents-prompt", { getCompiledPrompt: deps.getCompiledPrompt })
    .transform("collect-context", { sandbox: deps.sandbox })
    .transform("format-system-messages", {})
    .transform("format-user-messages", {})
    .transform("stream-llm", { apiKey: deps.apiKey, model: deps.model, tools: deps.tools })
    .boundary("check-follow-up", {})
    .sink("finalize", {})
    .build();
```

## 3. Element Registry

```typescript
const elementRegistry = new Map<string, ElementConstructor>();

export function registerElement(name: string, ctor: ElementConstructor): void {
  if (elementRegistry.has(name)) throw new Error(`Element "${name}" already registered`);
  elementRegistry.set(name, ctor);
}

export function resolveElement(name: string): ElementConstructor {
  const ctor = elementRegistry.get(name);
  if (!ctor) throw new Error(`Element "${name}" not found`);
  return ctor;
}
```

## 4. Pipeline Manager

```typescript
export class PipelineManager {
  #pipelines = new Map<string, Pipeline>();
  #builders = new Map<string, () => Pipeline>();

  register(name: string, builder: () => Pipeline): void { ... }
  get(name: string): Pipeline { ... }       // 惰性构建 + 缓存
  reload(name: string): Pipeline { ... }     // 强制重构建
}
```

## 5. Builder 验证 (build() 时)

1. 首个元素必须是 `source`
2. 末尾元素必须是 `sink`
3. 中间元素必须是 `transform` 或 `boundary`
4. Pipeline 内元素名不能重复
5. 所有元素名必须已注册

## 6. 新增 Pipeline 流程

```
1. 创建 src/packages/core/src/pipelines/<name>/
2. 定义 types.ts (Mode enum + FlowState)
3. 定义 elements/*.ts (每个 Element 一个文件)
4. 注册所有 elements
5. 定义 pipeline builder (index.ts)
6. 注册 builder 到 PipelineManager
7. 写测试
```

---

# Part 3: Event Bus

## 1. 核心实现

```typescript
export class PipelineEventBus<TEvents extends Record<string, any>> {
  #handlers = new Map<string, Set<(...args: any[]) => void>>();

  on<E extends keyof TEvents & string>(eventName: E, handler: (payload: TEvents[E]) => void): () => void {
    if (!this.#handlers.has(eventName)) this.#handlers.set(eventName, new Set());
    this.#handlers.get(eventName)!.add(handler);
    return () => this.#handlers.get(eventName)?.delete(handler);
  }

  emit<E extends keyof TEvents & string>(eventName: E, payload: TEvents[E]): void {
    const handlers = this.#handlers.get(eventName);
    if (!handlers) return;
    for (const handler of handlers) {
      try { handler(payload); } catch (error) { this.#errorHandler?.(eventName, error); }
    }
  }
}
```

**关键设计**：同步执行，一个 handler 出错不影响其他，`on()` 返回取消函数。

## 2. 事件类型映射

```typescript
export type PipelineEventMap = {
  "element.state-changed": { name: string; payload: { state: string } };
  "pipeline.element.started": { pipelineName: string; elementName: string; elementKind: string };
  "pipeline.element.finished": { pipelineName: string; elementName: string; elementKind: string; durationMs: number };
  "pipeline.element.failed": { pipelineName: string; elementName: string; elementKind: string; durationMs: number; error: unknown };
  "element.data": { name: string; payload: Record<string, unknown> };
};

export type CoreEventMap = {
  "task.enqueued": { task: TaskItem };
  "task.completed": { task: TaskItem; result: PipelineResult };
  "task.failed": { task: TaskItem; error: unknown };
};

export type DomainEventMap = {
  "transport.delta": { textDelta: string };
  "transport.tool.started": { toolName: string; toolCallId: string; input: unknown };
  "transport.tool.finished": { toolName: string; toolCallId: string; result?: unknown };
};

export type FullEventMap = PipelineEventMap & CoreEventMap & DomainEventMap;
```

## 3. 自定义事件

```typescript
// 1. 定义事件类型
export type SessionEventMap = {
  "session.created": { sessionId: string };
  "session.destroyed": { sessionId: string };
};

// 2. 扩展总事件映射
export type FullEventMap = PipelineEventMap & CoreEventMap & DomainEventMap & SessionEventMap;

// 3. 使用
bus.emit("session.created", { sessionId });
```

## 4. 使用模式

| 模式 | 代码 | 谁用 |
|------|------|------|
| Element 报告 | `this.report("element.data", {...})` | BaseElement 子类 |
| 服务发射 | `this.#bus.emit("task.completed", {...})` | TaskEngine 等服务 |
| 观察者监听 | `bus.on("transport.delta", handler)` | Broadcaster, Recorder |
| 清理 | `off() ` — on() 返回的取消函数 | 所有监听者 |

## 5. 测试

```typescript
test("bus emits and handles events", () => {
  const bus = new PipelineEventBus<TestEventMap>();
  const handler = mock(() => {});
  const off = bus.on("test.event", handler);
  bus.emit("test.event", { data: "hello" });
  expect(handler).toHaveBeenCalledWith({ data: "hello" });
  off();
  bus.emit("test.event", { data: "world" });
  expect(handler).toHaveBeenCalledTimes(1);
});
```

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [task-execution.md](./task-execution.md) | TaskEngine 如何驱动 Pipeline 执行 |
| [session.md](./session.md) | SessionContext 在 Pipeline 中的使用 |
| [../pipelines/conversation.md](../pipelines/conversation.md) | Conversation Pipeline — 9-Element 链完整参考 |
| [../standards/coding.md](../standards/coding.md) | 代码规范和类型约定 |
