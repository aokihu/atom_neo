# Bootstrap & Startup Sequence

> **Purpose**: Defines the exact initialization order for each package.
> Agent MUST follow this sequence when implementing startup code.

---

## 1. Startup Philosophy

**Rule**: Nothing starts until its dependencies are ready. Every component has a `start(): Promise<void>` method. Failures during init prevent the process from accepting traffic — fail fast, don't start broken.

---

## 2. Core Package — Startup Order

```text
START
  │
  ├── 1. Load Configuration
  │     config.load() — reads .env, CLI args, config file
  │
  ├── 2. Initialize Log System
  │     LogHub.create({ level: config.logLevel }) → register sinks (stdout, file)
  │     // level=1: essential only, level=2: +debug, level=3: +trace
  │
  ├── 3. Register Builtin Elements
  │     elementRegistry.set("collect-prompts", CollectPromptsElement)
  │     elementRegistry.set("stream-llm", StreamLLMElement)
  │     ... (all pipeline elements)
  │
  ├── 4. Register Builtin Tools
  │     toolRegistry.register(readTool)
  │     toolRegistry.register(writeTool)
  │     ... (all tools)
  │
  ├── 5. Initialize Services
  │     serviceManager.register(memoryService)
  │     serviceManager.startAll()
  │
  ├── 6. Initialize Session Store
  │     new SessionStore(config.maxSessions)
  │
  ├── 7. Initialize Task Engine
  │     new TaskEngine(bus, taskQueue, pipelineManager, sessionStore)
  │     taskEngine.start()
  │
  ├── 8. Build Pipeline Instances
  │     pipelineManager.register("conversation", () => conversationPipeline(deps))
  │     pipelineManager.register("prediction", () => predictionPipeline(deps))
  │     pipelineManager.register("follow-up", () => followUpPipeline(deps))
  │
  ├── 9. Initialize Replay System
  │     if (config.replay.enabled) { recorder.start() }
  │
  ├── 10. Start HTTP + WebSocket Server
  │      Bun.serve({ port: config.port, fetch: router, websocket: wsHandler })
  │
  └── READY — log "Core ready on :port"
```

### Startup Code Template

```typescript
// packages/core/src/server.ts

export async function startCore(): Promise<void> {
  const config = loadCoreConfig();

  // 2. Log system — level from config (default=1, only essential+error+warn+info)
  const logger = createLogger("core", { level: config.logLevel });
  logger.info("config loaded", { port: config.port, logLevel: config.logLevel });

  // 2-9. Initialize subsystems in dependency order
  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry);
  logger.info("tools registered", { count: toolRegistry.getAll().length });

  const memoryService = new MemoryService({ dbPath: config.memoryDbPath });
  await memoryService.start();

  const sessionStore = new SessionStore({ maxSessions: config.maxSessions });

  const elementRegistry = new Map();
  registerBuiltinElements(elementRegistry);

  const pipelineManager = new PipelineManager(elementRegistry);
  registerPipelines(pipelineManager, { runtime, toolRegistry });

  const taskQueue = new TaskQueue();
  const bus = new PipelineEventBus<PipelineEventMap>();

  const taskEngine = new TaskEngine({
    bus,
    taskQueue,
    pipelineManager,
    sessionStore,
    toolRegistry,
  });
  taskEngine.start();

  const recorder = new PipelineRecorder({ enabled: config.replayEnabled });

  // 10. Server (always last)
  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch(req, server) {
      return handleHttpRequest(req, {
        taskQueue, sessionStore, bus, recorder, pipelineManager,
      });
    },
    websocket: {
      open(ws) { /* register client */ },
      message(ws, msg) { handleWsMessage(ws, msg, { taskQueue, bus }); },
      close(ws) { /* unregister client */ },
    },
  });

  logger.info("core ready", { port: server.port, hostname: server.hostname });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    logger.info("shutting down");
    taskEngine.stop();
    server.stop();
    await memoryService.stop();
    process.exit(0);
  });
}
```

---

## 3. Gateway Package — Startup Order

```text
START
  │
  ├── 1. Load Configuration
  │     gatewayConfig.load()
  │
  ├── 2. Initialize Log System
  │
  ├── 3. Initialize Rate Limiter
  │     new RateLimiter(config.rateLimit)
  │
  ├── 4. Initialize JWT Verifier
  │     new JWTVerifier(config.jwtSecret)
  │
  ├── 5. Initialize Core Proxy
  │     new CoreProxy(config.coreUrl)
  │
  ├── 6. Start HTTP Server
  │     Bun.serve({ port: config.port, fetch: router })
  │
  └── READY
```

---

## 4. TUI Package — Startup Order

```text
START
  │
  ├── 1. Load Configuration
  │     tuiConfig.load()
  │
  ├── 2. Connect to Core via WebSocket
  │     ws = new WebSocket(coreUrl + "/ws/" + sessionId)
  │
  ├── 3. Wait for "session.ready" handshake
  │
  ├── 4. Initialize React TUI
  │     render(<App ws={ws} />)
  │
  └── READY
```

---

## 5. Graceful Shutdown (All Packages)

```typescript
const shutdown = async (signal: string) => {
  logger.info("shutdown", { signal });

  // 1. Stop accepting new connections
  server.stop();

  // 2. Wait for running tasks to complete (with timeout)
  await taskEngine.drain({ timeoutMs: 30_000 });

  // 3. Close all WebSocket connections
  for (const ws of activeConnections) {
    ws.close(1001, "Server shutting down");
  }

  // 4. Stop services
  await serviceManager.stopAll();

  // 5. Flush logs
  await logger.flush();

  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

---

## 6. Dependency Graph

```text
config ──→ log ──→ services ──→ tools ──→ elements ──→ pipelines
  │                    │                      │
  └── sessionStore ──→ taskEngine ────────────┘
                            │
                            └──→ HTTP Server (last)

# Everything depends on config and log.
# Services depend on nothing else.
# Tools depend on services (memory tool depends on memory service).
# Elements depend on tools (stream-llm needs tool registry for tool calling).
# Pipelines depend on elements.
# Session store depends only on config.
# Task engine depends on bus, queue, pipelines, session store.
# HTTP server depends on everything.
```

---

## 7. Entry Points

```text
# Each package has its own entry point:
packages/core/src/server.ts    → startCore()
packages/gateway/src/server.ts  → startGateway()
packages/tui/src/app.tsx        → startTUI()

# Package.json scripts (in each package):
"start": "bun run src/server.ts"

# Root scripts (development):
"dev:core":    "bun run --filter @atom-neo/core dev"
"dev:gateway": "bun run --filter @atom-neo/gateway dev"
"dev:tui":     "bun run --filter @atom-neo/tui dev"
"dev:all":     "bun run --workspaces dev"
```

---

## 8. Health Check Flow

```text
Client → GET /api/health
  → Core responds:
    {
      status: "ok" | "degraded" | "down",
      uptime: 3600,
      queue: { waiting: 3, processing: 1 },
      sessions: 42,
      memory: { connected: true, size: "12MB" },
      tools: { registered: 15, builtin: 12, mcp: 3 },
      version: "0.1.0"
    }
```
