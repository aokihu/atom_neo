# Dependency Injection Model

> **Purpose**: How objects are constructed and wired together without a DI container.
> Every component receives its dependencies via constructor parameters. No globals. No singletons.

---

## 1. Core Principle

**"Whoever creates an object, provides its dependencies."**

There is NO DI container. `main.ts` is the application composition root; `startCore` / `createCoreBootstrap` assemble the Core runtime. All other code receives pre-built dependencies.

---

## 2. The Construction Chain

```text
main.ts
  │
  ├── config / logger / sandbox / HttpServer adapter
  ├── ServiceManager          # register / startAll / stopAll only
  └── CoreServices object     # memory / network / skill? / compiler?
        │
        └── startCore({ services, runtime, logger, httpServer? })
              ├── resolveCoreServices({ services })    # fail fast
              ├── createCoreBootstrap()
              │     ├── promptRegistry  = createPromptRegistry()
              │     ├── promptResolver  = createPromptResolver(promptRegistry)
              │     ├── elementRegistry = createElementRegistry()
              │     ├── pipelineStore   = new PipelineInstanceStore()
              │     ├── bus / taskQueue / SessionStore / tools / MCP
              │     ├── register*Elements(elementRegistry)  # 7 pipelines
              │     ├── createPipelineFactory({ elementRegistry, promptResolver, ... })
              │     ├── new TaskEngine({ bus, queue, pipelineStore, pipelineBuilders })
              │     │     └── taskEngine.start()
              │     └── createWsHandlers({ ... })
              └── httpServer.serve({ fetch: router.fetch, upgrade: router.upgrade, websocket })
```

`server.ts` owns the HTTP/WS lifecycle and shutdown order; `bootstrap.ts` only assembles collaborators. There is no module-level registry, prompt singleton or pipeline map.

### CoreServices Boundary

`@atom-neo/core` does not read services through string keys. `main.ts` builds one
explicit `CoreServices` object from the concrete instances and passes it to
`startCore({ services, ... })`:

```typescript
type CoreServices = {
  memory: MemoryServiceLike;   // required
  network: NetworkServiceLike; // required
  skill?: SkillServiceLike;    // optional
  compiler?: { getCompiledPrompt(): string }; // optional
};

resolveCoreServices({ services }); // fail fast before Core is constructed
```

`ServiceManager` still owns `register/startAll/stopAll`, but it is no longer
passed into Core. Missing `memory` or `network` throws at the `startCore`
boundary with the service name in the error.

### PromptRegistry Boundary

Prompt lookups use a per-Core registry plus a narrow resolver. There is no
module-level `_instance`, `getRegistry()`, `initPromptRegistry()` or free
`resolvePrompt()`:

```typescript
const promptRegistry = createPromptRegistry();          // independent per Core
const promptResolver = createPromptResolver(promptRegistry);
// (key: PromptKey, providerModel?: string) => string

createPipelineFactory({ promptResolver, ... });         // passed to every pipeline
// Element params: { promptResolver, providerModel? }
```

`createPromptRegistry()` registers the same language/model variants on every
instance; `createPromptResolver()` keeps the `openai/gpt-4o` default and the
English fallback for unknown providers. Elements and `callLLM` / `chooseDecision`
receive the resolver explicitly. Tests construct their own registry/resolver
instead of relying on bootstrap initialization.

### ElementRegistry Boundary

Element constructors are resolved through a per-Core `ElementRegistry`. There is
no module-level `Map`, `registerElement()`, `resolveElement()`, `getRegisteredNames()`
or `clearRegistry()`:

```typescript
const elementRegistry = createElementRegistry();       // independent per Core
registerConversationElements(elementRegistry);         // all 7 register*Elements take it
registerSharedElements(elementRegistry);

createPipelineFactory({ elementRegistry, ... });       // each pipeline() call receives it
// PipelineBuilder(name, elementRegistry).build(bus)
```

Duplicate names still throw `Element "<name>" already registered`; missing names
still throw `Element "<name>" not found. Registered: [...]`. Two registries can
hold the same names without interfering.

### Element Session Boundary

Elements depend on the structural `PipelineSession`, not the concrete
`SessionContext` or `any`. Every member has a real Element call site; the task
shape stays `TaskItem` through `ElementTask`. Memory intent handling uses the
`ElementMemory` subset (`retain` / optional `findFullId` / optional `has`):

```typescript
import type { PipelineSession, ElementTask } from "@atom-neo/core";

class ExampleElement {
  #session: PipelineSession;
  #task?: ElementTask;

  constructor(params: { session: PipelineSession; task?: ElementTask }) {
    this.#session = params.session;
    this.#task = params.task;
  }
}
```

`SessionContext` is assignable to `PipelineSession` at compile time
(`session/element-session.test.ts`); an object missing required session fields
fails typecheck. `CheckpointSession` adds only `exportState`, so context
compression can hand its narrow session to `SessionPersistenceService`.
`getTaskPayload(task, "text")` replaces untyped payload scans. This boundary is
guarded against regression by a static test over `pipelines/**` production files.

### PipelineInstanceStore Boundary

`TaskEngine` caches each built pipeline for the lifetime of one task through an
injected `PipelineInstanceStore`; `api/tasks.ts` no longer owns pipeline state:

```typescript
const pipelineStore = new PipelineInstanceStore();     // independent per Core
new TaskEngine({ bus, queue, pipelineStore, pipelineBuilders });
// get(taskId) / set(taskId, pipeline) / delete(taskId) / size / clear
```

`finally` deletes the entry after success, failure or cancellation, and queued
cancellation deletes it before execution. Two engines with two stores never share
pipeline instances for the same task id. There is no TTL or capacity policy.

### TaskEngine Boundary

`TaskEngine` owns a single run loop and delegates one task to `TaskRunner`:

```typescript
const engine = new TaskEngine({ bus, queue, pipelineStore, pipelineBuilders });
engine.start(); // idempotent; Task.Enqueued only calls wake.notify()
```

`TaskRunner` receives the store and builders, builds or reuses one pipeline per task,
and passes `{ ...state, abortSignal }` to every element. The `Wakeup` primitive retains
a notify that arrives before `wait()`, so the scheduler needs no timer or polling.
`stop()` never aborts the current task; `drain()` still polls `queue.size` and returns
`false` on timeout.

### Dual-Instance Acceptance

`src/packages/core/src/server-dual-instance.test.ts` starts two complete
`startCore` instances in one process with different sandboxes, fake runtimes,
services, admin tokens and ports. Both `/api/health` and `/api/tui/attach`
work, each attach reports its own port/sandbox/theme/model, sessions do not
cross, and stopping one Core leaves the other healthy. Startup itself proves
element registry isolation: both instances register the same element names
without an `already registered` error. A static guard
(`global-state-guard.test.ts`) keeps `pipelineMap`, `clearRegistry`,
`getRegistry(`, `initPromptRegistry(`, free `resolvePrompt(`, `let _instance`
and module-level `const registry = new Map` out of production sources.

---

## 3. Every Constructor Follows This Pattern

```typescript
class MyComponent {
  // Private read-only dependencies
  #depA: DepA;
  #depB: DepB;
  #config: MyConfig;

  constructor(params: {
    depA: DepA;
    depB: DepB;
    config: MyConfig;   // Type-safe config slice
  }) {
    this.#depA = params.depA;
    this.#depB = params.depB;
    this.#config = params.config;
  }
}
```

**Rules:**
- Constructor takes a single `params` object (not positional args)
- Dependencies are stored as `#private` fields
- No default values for services — they must be provided
- Config can have defaults if appropriate
- NEVER `new` anything in a constructor that isn't explicitly passed in

---

## 4. What NOT to Do

```typescript
// BAD: Global singleton
const globalRuntime = new Runtime();
export function getRuntime() { return globalRuntime; }

// BAD: Factory pattern hiding dependencies
class ElementFactory {
  static createCollectPrompts() {
    return new CollectPromptsElement({
      runtime: getGlobalRuntime(),  // hidden dependency!
      bus: getGlobalBus(),
    });
  }
}

// BAD: Service locator
class MyElement {
  constructor() {
    this.runtime = ServiceLocator.get("runtime");  // hidden!
  }
}

// BAD: Lazy initialization
class MyService {
  #db?: Database;
  getDb() {
    if (!this.#db) this.#db = new Database();  // constructor hidden!
    return this.#db;
  }
}
```

---

## 5. Config Slicing — Don't Pass Entire Config

```typescript
// BAD: Pass the whole config
class MemoryService {
  constructor(config: CoreConfig) {  // Has 20 fields, only needs 2
    this.#dbPath = config.memoryDbPath;
    this.#maxResults = config.maxSessions;  // wait, wrong field!
  }
}

// GOOD: Pass only what's needed
class MemoryService {
  constructor(params: { dbPath: string }) {
    this.#dbPath = params.dbPath;
  }
}

// In bootstrap:
new MemoryService({ dbPath: config.memoryDbPath })
```

---

## 6. AppContext Pattern (Optional, for Deeply Nested Trees)

```typescript
// If a component needs many dependencies, group them by concern:

type RuntimeDeps = {
  config: CoreConfig;
  logger: Logger;
  toolRegistry: ToolRegistry;
  sessionStore: SessionStore;
  memoryService: MemoryService;
};

class ConversationOrchestrator {
  constructor(deps: RuntimeDeps) {
    // Access what you need from deps
  }
}

// Used in bootstrap:
const runtimeDeps: RuntimeDeps = {
  config, logger, toolRegistry, sessionStore, memoryService,
};
new ConversationOrchestrator(runtimeDeps);
```

A `RuntimeDeps` group is acceptable when multiple subsystems share the same dependencies. But it should be SMALL (≤5 fields). If it grows, split into smaller groups.

---

## 7. Testing with DI

```typescript
// Because everything is constructor-injected, testing is trivial:

test("MemoryService stores and retrieves", async () => {
  const service = new MemoryService({ dbPath: ":memory:" });  // SQLite in-memory
  await service.start();

  const result = await service.search({ query: "test", scope: "long" });

  expect(result.outputs).toEqual([]);
});
```

No mocking framework needed for most tests. Only mock external services (LLM, HTTP) via `mock.module`.

---

## 8. Lifecycle Methods

```typescript
interface Startable {
  start(): Promise<void>;
}
interface Stoppable {
  stop(): Promise<void>;
}

// Services implement Startable + Stoppable:
class MemoryService implements Startable, Stoppable {
  async start() { /* open DB, create tables */ }
  async stop() { /* close DB, flush writes */ }
}

// Elements do NOT implement Startable/Stoppable.
// They are stateless processing units (lifecycle managed by PipelineRunner).
```

---

## 9. Async Init Anti-Pattern

```typescript
// BAD: Constructor is async (can't be)
class BadService {
  constructor() {
    this.init();  // Fire-and-forget! Race condition!
  }
  async init() { /* ... */ }
}

// GOOD: Explicit start() method
class GoodService {
  constructor(params: { dbPath: string }) {
    this.#dbPath = params.dbPath;
    // Constructor only stores config.
  }
  async start() {
    this.#db = await openDatabase(this.#dbPath);
    // Heavy init in start().
  }
}
```

---

## 10. Dependency Validation at Startup

```typescript
// Bootstrap should validate critical dependencies before starting:

function validateDeps(deps: RuntimeDeps): void {
  if (deps.toolRegistry.getAll().length === 0) {
    throw new Error("No tools registered. At least read tool is required.");
  }

  // Check file paths exist
  const dbFile = Bun.file(deps.config.memoryDbPath);
  if (!(await dbFile.exists())) {
    logger.warn("database file does not exist, will create", {
      path: deps.config.memoryDbPath,
    });
  }
}
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [coding.md](./coding.md) | DI 代码风格约束 |
| [bootstrap.md](../overview/bootstrap.md) | 实际构造链和注入顺序 |
