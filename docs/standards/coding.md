# Development Standards

> **Purpose**: Mandatory code style, naming conventions, type system rules for all Atom Neo development.

---

# Part 1: Coding Conventions

## 1. Core Principle: Less Code, More Power

- 不要写不必要的注释。代码本身应该是自解释的。
- 不要引入不必要的抽象层。如果只有一个实现，就不需要接口。
- 删掉没用到的代码，不要留着"以备后用"。
- 优先使用标准库，其次使用已安装的依赖，最后才考虑新增依赖。

## 2. TypeScript Strictness

```typescript
// ALWAYS use strict types. NEVER use `any` except for:
// 1. Third-party library interop where types are unavailable
// 2. Generic constraints where exact type doesn't matter
// 3. Explicit `as any` casts with a comment explaining why

// BAD
function process(data: any) { ... }

// GOOD
function process(data: unknown) {
  if (typeof data === 'object' && data !== null) { ... }
}
```

## 3. File Structure Convention

```text
module-name/
├── index.ts          # Barrel export ONLY — re-exports from other files
├── types.ts          # Type definitions specific to this module
├── <name>.ts         # Main implementation
└── elements/         # If module contains Elements
    ├── element-a.ts
    └── element-b.ts
```

## 4. Import Convention

```typescript
// External packages first
import { z } from "zod";
import { streamText } from "ai";

// Internal packages (shared)
import { BaseElement } from "@atom-neo/shared";

// Same package, relative
import { type MyTypes } from "./types";

// NEVER use absolute path aliases across package boundaries.
```

## 5. Error Handling

```typescript
// Pipeline Elements: throw errors
// HTTP handlers: catch, return 4xx/5xx JSON
// Tool execution: catch, return { ok: false, error: message }

// BAD: silent catch
try { await doStuff(); } catch { }

// GOOD: always report
try {
  await doStuff();
} catch (error) {
  this.report("element.data", { error: errorMessage(error) });
  throw error;
}
```

## 6. Async & Immutability

```typescript
// Prefer async/await over raw promises. NEVER mix .then() with await.

// FlowState: always return NEW object, never mutate input
// BAD:  input.mode = "new_mode"; return input;
// GOOD: return { ...input, mode: "new_mode" };
```

## 7. Classes: When to Use

```typescript
// Use classes: private state (#field), extends BaseElement, lifecycle (start/stop)
// Use functions: pure data transformation, utilities, config objects
```

## 8. Logging

```typescript
// Log levels: debug < info < warn < error
logger.debug("element.passthrough", { name, reason });
logger.info("session.created", { sessionId });
logger.warn("retry.attempt", { attempt });
logger.error("pipeline.failed", { taskId, error: String(err) });
// NEVER: console.log in production code
```

## 9. Type Imports & Exports

```typescript
// ALWAYS use `import type` for type-only imports
import type { TaskItem } from "@atom-neo/shared";
import { PipelineRunner } from "@atom-neo/shared";  // value import

// NO default exports. Every .ts file MUST have a header comment.

// Use Enum for runtime values, Union for type-level only
export enum PipelineResultType { Complete = "complete" }
export type LogLevel = "debug" | "info" | "warn" | "error";
```

## 10. Monorepo Package Rules

- `shared/` MUST NOT import from `core/`, `gateway/`, or `tui/`
- `core/` MAY import from `shared/`
- `gateway/` MAY import from `shared/`
- `tui/` MAY import from `shared/`
- Packages MUST NOT have circular dependencies

---

# Part 2: Naming Conventions

## 1. Files

```text
# Lowercase kebab-case
element-name.ts          # Element implementation
element-name.test.ts     # Corresponding test
types.ts                 # Type definitions
index.ts                 # Barrel exports

pipelines/
├── conversation/
│   ├── index.ts
│   ├── types.ts
│   └── elements/
│       ├── collect-prompts.ts
│       └── finalize.ts
```

## 2. Semantic Function Prefixes

| Prefix | Meaning | Example |
|--------|---------|---------|
| `create` | 从无到有创建实体 | `createTaskItem()` |
| `build` | 组装现有部件 | `buildTransportPayload()` |
| `parse` | 文本 → 结构化数据 | `parseIntentRequest()` |
| `resolve` | 查找/决策 | `resolveModel()` |
| `normalize` | 规范化输入 | `normalizeConfig()` |
| `validate` | 校验并返回结果 | `validateTaskPayload()` |
| `apply` | 把结果写入状态 | `applyExecutionResult()` |
| `emit` | 发送事件 | `emitTaskCompleted()` |
| `register` | 注册到容器 | `registerTool()` |
| `export` | 从内部数据源导出文本 | `exportSystemPrompt()` |
| `report` | 非阻塞报告/日志 | `reportAnalysis()` |
| `off*` | eventBus.on() 取消函数 | `offDelta` |

## 3. Classes & Types

```typescript
// Classes: PascalCase
class PipelineRunner { }
class TaskEngine { }

// Abstract base: Base prefix
abstract class BaseElement<I, O> { }
abstract class BaseService { }

// Elements: descriptive + Element suffix
class StreamLLMElement extends BaseElement { }
class FinalizeConversationElement extends BaseElement { }

// Types/Interfaces: PascalCase, descriptive
type TaskItem = { ... }
type PipelineResult = { ... }

// Discriminated unions: discriminant is always `mode` or `type`
// Enum members: PascalCase
// Generic type parameters: single uppercase letter (I, O, T)
```

## 4. Variables

```typescript
// camelCase for locals, # prefix for private fields
class MyElement {
  #runtime: Runtime;
  #config: ElementConfig;
}

// UPPER_SNAKE_CASE for module-level constants
const MAX_OUTPUT_TOKENS = 4096;

// Boolean: is/has/can/should prefix
const isRunning = true;
const hasStreamedOutput = false;

// Event handlers: on + EventName
onTaskEnqueued(task: TaskItem): void
```

## 5. Tests

```text
# File: <name>.test.ts
# Test name: plain English
test("completes task when pipeline returns success")

# describe: module or class name
describe("PipelineRunner", () => { ... })
```

---

# Part 3: Type System

## 1. Type File Layout

```text
src/packages/shared/src/types/
├── index.ts          # Barrel exports
├── task.ts           # TaskItem, TaskState, TaskPayload
├── intent.ts         # IntentRequest, IntentRequestType
├── memory.ts         # MemoryNode, MemoryLink, MemoryScope
├── tool.ts           # ToolDefinition, ToolResult, PermissionLevel
├── pipeline.ts       # PipelineResult, PipelineEventMap, FlowState
├── session.ts        # SessionContext types
├── config.ts         # Configuration types
└── primitive.ts      # UUID, ISOTimeString
```

## 2. Core Types

### Task

```typescript
export enum TaskSource { EXTERNAL = "external", INTERNAL = "internal" }

export type TaskItem = {
  readonly id: string; readonly chainId: string;
  readonly parentTaskId: string | null; readonly sessionId: string;
  readonly chatId: string; readonly source: TaskSource;
  readonly pipeline: string; readonly priority: number;
  readonly createdAt: number; readonly payload: TaskPayload[];
  state: TaskState; updatedAt: number;
};

export enum TaskState {
  WAITING = "waiting", PENDING = "pending", PROCESSING = "processing",
  COMPLETED = "completed", FAILED = "failed", FOLLOW_UP = "follow_up",
  DISPATCHED = "dispatched", SUSPEND = "suspend",
}

export type TaskPayload =
  | { type: "text"; data: string }
  | { type: "image"; data: string }
  | { type: "tool_report"; data: TaskToolReport };
```

### Intent

```typescript
export enum IntentRequestType { FOLLOW_UP = "follow_up" }

export type IntentRequest = {
  source: IntentRequestSource;
  request: IntentRequestType;
  intent: string;
  params: Record<string, unknown>;
};

// NOTE: SEARCH_MEMORY and EXECUTE_TOOL go through AI SDK tool calling
// Only FOLLOW_UP uses tail text parsing via IntentRequest
```

### Pipeline

```typescript
export type PipelineResult =
  | { type: typeof PipelineResultType.Complete; task: TaskItem }
  | { type: typeof PipelineResultType.Enqueue; transition: PipelineEnqueueTransition; task: TaskItem; nextTask: TaskItem }
  | { type: typeof PipelineResultType.SuspendAndEnqueueChild; task: TaskItem; childTask: TaskItem }
  | { type: typeof PipelineResultType.ResumeParentAndEnqueue; task: TaskItem; parentTaskId: string; nextTask: TaskItem };

export type FlowState = { mode: string };

export type PipelineEventMap = {
  "element.state-changed": { name: string; payload: { state: string } };
  "pipeline.element.started": { pipelineName: string; elementName: string; elementKind: string };
  "pipeline.element.finished": { pipelineName: string; elementName: string; elementKind: string; durationMs: number };
  "pipeline.element.failed": { pipelineName: string; elementName: string; elementKind: string; durationMs: number; error: unknown };
  "element.data": { name: string; payload: Record<string, unknown> };
};
```

### Primitive

```typescript
export type UUID = string & { readonly __brand: "UUID" };
export type ISOTimeString = string & { readonly __brand: "ISOTimeString" };
```

## 3. Discriminated Union Pattern

```typescript
// Discriminant: `type` (for result) or `mode` (for FlowState)

export type MyUnion =
  | { type: typeof MyEnum.VariantA; fieldA: string }
  | { type: typeof MyEnum.VariantB; fieldB: number };

function handle(input: MyUnion) {
  if (input.type === MyEnum.VariantA) {
    input.fieldA;  // narrowed
  }
}
```

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [testing.md](./testing.md) | 测试规范 |
| [dependency-injection.md](./dependency-injection.md) | 依赖注入模型 |
