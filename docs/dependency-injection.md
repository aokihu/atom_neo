# Dependency Injection Model

> **Purpose**: How objects are constructed and wired together without a DI container.
> Every component receives its dependencies via constructor parameters. No globals. No singletons.

---

## 1. Core Principle

**"Whoever creates an object, provides its dependencies."**

There is NO DI container. The bootstrap function in `server.ts` is the ONLY place where objects are constructed. All other code receives pre-built dependencies.

---

## 2. The Construction Chain

```text
bootstrap()
  │
  ├── config = loadConfig()
  │
  ├── logger = createLogger(config)
  │
  ├── memoryService = new MemoryService({ dbPath: config.memoryDbPath })
  │     └── memoryService.start()
  │
  ├── sessionStore = new SessionStore({ maxSessions: config.maxSessions })
  │
  ├── toolRegistry = new ToolRegistry()
  │     ├── toolRegistry.register(readTool)
  │     ├── toolRegistry.register(writeTool)
  │     └── toolRegistry.register(searchMemoryTool)
  │
  ├── bus = new PipelineEventBus<PipelineEventMap>()
  │
  ├── elementRegistry = new Map()
  │     ├── elementRegistry.set("collect-prompts", CollectPromptsElement)
  │     └── elementRegistry.set("stream-llm", StreamLLMElement)
  │
  ├── pipelineManager = new PipelineManager(elementRegistry)
  │     └── registerPipelines(pipelineManager, { toolRegistry, bus })
  │
  ├── taskQueue = new TaskQueue()
  │
  ├── taskEngine = new TaskEngine({ bus, taskQueue, pipelineManager, sessionStore })
  │     └── taskEngine.start()
  │
  └── server = Bun.serve({ ... })
```

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
  if (!deps.config.jwtSecret || deps.config.jwtSecret.length < 16) {
    throw new Error("jwtSecret must be at least 16 characters");
  }

  if (deps.toolRegistry.getAll().length === 0) {
    throw new Error("No tools registered. At least read tool is required.");
  }

  // Check file paths exist
  if (!fs.existsSync(deps.config.memoryDbPath)) {
    logger.warn("database file does not exist, will create", {
      path: deps.config.memoryDbPath,
    });
  }
}
```
