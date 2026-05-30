# Coding Conventions

> **Purpose**: Mandatory code style, patterns, and conventions for all Atom Neo development.
> All code must conform to these rules. AI Agents MUST follow these when generating code.

---

## 1. Core Principle: Less Code, More Power

- 不要写不必要的注释。代码本身应该是自解释的。
- 不要引入不必要的抽象层。如果只有一个实现，就不需要接口。
- 删掉没用到的代码，不要留着"以备后用"。
- 优先使用标准库，其次使用已安装的依赖，最后才考虑新增依赖。

## 2. TypeScript Strictness

```typescript
// ALWAYS use strict types. NEVER use `any` except for:
// 1. Third-party library interop where types are unavailable
// 2. Generic constraints where exact type doesn't matter (e.g., Pipeline<any, any>)
// 3. Explicit `as any` casts with a comment explaining why

// BAD
function process(data: any) { ... }

// GOOD
function process(data: unknown) {
  if (typeof data === 'object' && data !== null) { ... }
}

// ACCEPTABLE (with reason)
type Pipeline<I = any, O = any> = { ... }  // Element chain typing is intentionally weak
```

## 3. File Structure Convention

```text
# Every module follows this structure:
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
import { BaseElement, PipelineRunner } from "@atom-neo/shared";

// Same package, relative
import { type MyTypes } from "./types";
import { helper } from "./helpers";

// NEVER use absolute path aliases across package boundaries.
// Each workspace package has its own tsconfig paths.
```

## 5. Error Handling

```typescript
// Pipeline Elements: throw errors, let PipelineRunner handle
// PipelineRunner: catches, emits "element.failed" event, rethrows
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

## 6. Async Patterns

```typescript
// Prefer async/await over raw promises
// BAD
function getData() {
  return fetch(url).then(r => r.json());
}

// GOOD
async function getData() {
  const r = await fetch(url);
  return r.json();
}

// NEVER mix .then() with await in the same function
// NEVER use callback-style APIs; wrap in promises if needed
```

## 7. Immutability

```typescript
// TaskItem: use `readonly` for immutable fields
// PipelineContext: create new context, don't mutate
// FlowState: always return NEW object, never mutate input

// BAD
function process(input: State): State {
  input.mode = "new_mode";  // mutation!
  return input;
}

// GOOD
function process(input: State): State {
  return { ...input, mode: "new_mode" };
}
```

## 8. No Classes Without Reason

```typescript
// Use classes when:
// 1. You need private state (#field)
// 2. You extend BaseElement
// 3. You implement a service with lifecycle (start/stop)

// Use plain functions/objects when:
// 1. Pure data transformation
// 2. Utility functions
// 3. Configuration objects

// BAD: unnecessary class
class StringFormatter {
  format(s: string) { return s.trim(); }
}

// GOOD: simple function
const format = (s: string) => s.trim();
```

## 9. Dependencies

```typescript
// Injection via constructor parameters, NOT singletons or globals
// Elements receive dependencies explicitly:

// BAD
const runtime = getGlobalRuntime();

// GOOD
class MyElement {
  #runtime: Runtime;
  constructor(params: { runtime: Runtime }) {
    this.#runtime = params.runtime;
  }
}
```

## 10. Logging

```typescript
// Log level: "debug" | "info" | "warn" | "error" (increasing severity)
// --log-level=<level>: minimum level to output (default: debug)
// --log-ignore=<level>: suppress specific levels (can repeat)

// Logger API:
logger.debug("element.passthrough", { name, reason });
logger.info("session.created", { sessionId });
logger.warn("retry.attempt", { attempt });
logger.error("pipeline.failed", { taskId, error: String(err) });

// Log entry structure:
// { level: LogLevel, message: string, timestamp: number, context?: Record<string, unknown> }

// NEVER: console.log, console.error in production code
// EXCEPTION: test files may use console.log for debugging
```

## 11. Type Imports

```typescript
// ALWAYS use `import type` for type-only imports
import type { TaskItem } from "@atom-neo/shared";
import { PipelineRunner } from "@atom-neo/shared";  // value import

// Inline type imports for mix:
import { type Runtime, execute } from "@atom-neo/shared";
```

## 12. File Header Comments

Every `.ts` file MUST have a header comment:

```typescript
/**
 * Short description of what this file does.
 *
 * Additional detail if needed. Max 5 lines.
 */
```

## 13. No Default Exports

```typescript
// BAD
export default class MyElement { }

// GOOD
export class MyElement { }
```

## 14. Enum vs Union Types

```typescript
// Use Enum when:
// - Values are used at RUNTIME (switch/case, comparisons)
// - Values are part of the wire protocol (serialized/deserialized)
// - Values appear in discriminated unions as discriminants

// Use Union type when:
// - Values are only used at TYPE level (no runtime access)
// - Short list of string literals in function parameter types

// GOOD: Enum for runtime discriminant
export enum PipelineResultType {
  Complete = "complete",
  Enqueue = "enqueue",
}

// GOOD: Union for type-level only
export type LogLevel = "debug" | "info" | "warn" | "error";
```

## 15. Monorepo Package Rules

- `shared/` MUST NOT import from `core/`, `gateway/`, or `tui/`
- `core/` MAY import from `shared/`
- `gateway/` MAY import from `shared/`
- `tui/` MAY import from `shared/`
- Packages MUST NOT have circular dependencies
