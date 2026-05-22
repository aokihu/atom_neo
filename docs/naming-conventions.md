# Naming Conventions

> **Purpose**: Mandatory naming rules for files, classes, functions, variables, and types.
> All generated code MUST follow these conventions.

---

## 1. Files

```text
# Lowercase kebab-case
element-name.ts          # Element implementation
element-name.test.ts     # Corresponding test
types.ts                 # Type definitions
index.ts                 # Barrel exports

# Pipeline definitions: one directory per pipeline
pipelines/
├── conversation/
│   ├── index.ts
│   ├── types.ts
│   └── elements/
│       ├── collect-prompts.element.ts
│       └── finalize.element.ts
└── prediction/
    └── ...
```

## 2. Semantic Function Prefixes

| Prefix | Meaning | When to Use | Example |
|--------|---------|-------------|---------|
| `create` | 从无到有创建实体 | 工厂函数、构造辅助 | `createTaskItem()`, `createError()` |
| `build` | 组装现有部件 | 从已有数据拼装复杂对象 | `buildTransportPayload()`, `buildExecutionContext()` |
| `parse` | 文本 → 结构化数据 | 解析/反序列化 | `parseIntentRequest()`, `parseConfig()` |
| `resolve` | 查找/决策 | 从配置或策略中确定值 | `resolveIntentPolicy()`, `resolveModel()` |
| `normalize` | 规范化输入 | 清理/默认值/裁剪 | `normalizeConfig()`, `normalizePath()` |
| `validate` | 校验并返回结果 | 返回 `{ ok, error? }` | `validateTaskPayload()` |
| `apply` | 把结果写入状态 | 副作用操作 | `applyExecutionResult()`, `applyToolReport()` |
| `emit` | 发送事件 | 向 EventBus 发送消息 | `emitTaskCompleted()` |
| `register` | 注册到容器 | Service/Tool/Element 注册 | `registerTool()`, `registerElement()` |
| `export` | 从内部数据源导出文本 | Prompt 生成 | `exportSystemPrompt()`, `exportUserPrompt()` |
| `report` | 非阻塞报告/日志 | 调试、分析、审计 | `reportAnalysis()`, `reportMemoryUsage()` |
| `off*` | 存储 `eventBus.on()` 返回的取消函数 | Event listener cleanup | `offDelta`, `offResolved` |

## 3. Class Naming

```typescript
// Classes: PascalCase
class PipelineRunner { }
class TaskEngine { }
class SessionContext { }

// Abstract base classes: Base prefix
abstract class BaseElement<I, O> { }
abstract class BaseService { }

// Elements: descriptive name + Element suffix
class CollectPromptsElement extends BaseElement { }
class StreamLLMElement extends BaseElement { }
class FinalizeConversationElement extends BaseElement { }

// Services: descriptive name + Service suffix (if providing system-level capability)
class MemoryService { }
class ToolService { }
```

## 4. Type Naming

```typescript
// Types/Interfaces: PascalCase, descriptive
type TaskItem = { ... }
type PipelineResult = { ... }
type PipelineContext = { ... }

// Discriminated unions: the discriminant field is always `mode` or `type`
type FlowState = { mode: Mode; ... } | { mode: Mode; ... }
type PipelineResult = { type: Type; ... } | { type: Type; ... }

// Enum members: PascalCase
enum PipelineResultType {
  Complete = "complete",
  Enqueue = "enqueue",
}

// Mode enums (for FlowState): PipelineName + Mode suffix
enum FormalConversationMode { ... }
enum PostFollowUpMode { ... }

// Generic type parameters: single uppercase letter, or descriptive if needed
class Pipeline<I, O> { }
class EventBus<TEvents extends Record<string, any>> { }
class Builder<TElement extends BaseElement> { }
```

## 5. Variable Naming

```typescript
// Local variables: camelCase
const taskQueue = new TaskQueue();
const eventBus = new PipelineEventBus();

// Private fields: # prefix (TypeScript private)
class MyElement {
  #runtime: Runtime;
  #config: ElementConfig;
}

// Constants: UPPER_SNAKE_CASE (at module level or for magic values)
const MAX_OUTPUT_TOKENS = 4096;
const READY_TO_FINALIZE = "ready_to_finalize";

// Boolean variables: is/has/can/should prefix
const isRunning = true;
const hasStreamedOutput = false;
const canExecute = task.state === TaskState.READY;
const shouldFallback = result.ok === false;

// Destructured parameters: use same name as property
constructor(params: { ctx: PipelineContext; runtime: Runtime }) {
  // NOT: const { ctx: context, runtime: rt } = params;
  // GOOD:
  const { ctx, runtime } = params;
}
```

## 6. Function Naming

```typescript
// Event handlers: on + EventName
onTaskEnqueued(task: TaskItem): void
onPipelineFinished(result: PipelineResult): void

// Async functions: NO special suffix (no `Async` postfix)
// BAD: fetchDataAsync()
// GOOD: fetchData()

// Boolean-returning functions: is/has/can/should prefix
function isSearchHit(output: MemoryOutput): boolean { ... }
function hasPendingToolCalls(input: State): boolean { ... }

// Constructor-like factories: create prefix
function createTaskItem(...): TaskItem { ... }
function createSessionContext(id: string): SessionContext { ... }
```

## 7. File Path Naming

```text
packages/
├── core/src/session/context.ts    # NOT: session-context.ts, SessionContext.ts
├── core/src/tools/registry.ts     # NOT: tool-registry.ts, ToolRegistry.ts
├── core/src/pipelines/conversation/index.ts  # NOT: formal-conversation/
└── shared/src/types/task.ts       # NOT: TaskItem.ts, task-types.ts
```

## 8. Test Naming

```text
# Test files: same name as source + .test.ts
runner.ts → runner.test.ts
task-queue.ts → task-queue.test.ts

# Test descriptions: plain English
test("completes task when pipeline returns success")  // GOOD
test("test pipeline success")                          // BAD

# describe blocks: module or class name
describe("PipelineRunner", () => { ... })
describe("TaskEngine", () => { ... })
```

## 9. Diagram of Naming Patterns

```text
createXxx()       → Factory: creates new entity
buildXxx()        → Builder: assembles from parts
parseXxx()        → Parser: text → structured data
resolveXxx()      → Resolver: lookup/decision
normalizeXxx()    → Normalizer: cleanup/defaults
validateXxx()     → Validator: check + return result

applyXxx()        → Side-effect: write result to state
emitXxx()         → Event: send to bus
registerXxx()     → Registration: add to container
exportXxx()       → Export: extract data for external use
reportXxx()       → Report: non-blocking log/analytics

onXxx()           → Event handler
offXxx()          → Event unsubscriber
isXxx()           → Boolean predicate
hasXxx()          → Presence check
canXxx()          → Capability check
shouldXxx()       → Conditional decision
```
