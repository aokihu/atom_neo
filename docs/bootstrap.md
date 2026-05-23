# Bootstrap & Startup Sequence

> **Purpose**: Defines the exact initialization order for each package.
> Agent MUST follow this sequence when implementing startup code.

---

## 1. Startup Philosophy

**Rule**: Nothing starts until its dependencies are ready. Every component has a `start(): Promise<void>` method. Failures during init prevent the process from accepting traffic — fail fast, don't start broken.

---

## 2. CLI Arguments

```bash
bun run src/main.ts [options]

Options:
  --mode core|tui|full    启动模式（默认 core）
  --port <number>         HTTP 端口（默认自动分配）
  --host <ip>             绑定地址（默认 127.0.0.1）
  --sandbox <path>        沙箱工作目录（默认 CWD）
  --log-level debug|info|warn|error  最小日志级别（默认 debug）
  --log-ignore <level>    忽略指定级别的日志（可重复）
  --log-file <path>       日志输出到文件（mode≠core 时可用）
  --log-pipepath <path>   Named pipe 路径（mode≠core 时可用）
```

**日志规则：**
- `--mode core` → 自动输出到 console
- `--mode core` + `--log-file`/`--log-pipepath` → console 被抑制，仅输出到指定 sink
- `--mode tui|full` → 默认无日志输出；设置 `--log-pipepath` 启用 pipe 输出；设置 `--log-file` 启用文件输出；两者可共存

---

## 3. Config File (`$SANDBOX/config.json`)

```json
{
  "transport": { "maxOutputTokens": 4096 },
  "gateway": { "port": 3000, "jwtSecret": "..." },
  "tui": { "theme": "dark" }
}
```

不含 server 配置（port/host 走 CLI）。文件缺失时使用默认值。

---

## 4. Environment (`$SANDBOX/.env`)

```bash
DEEPSEEK_API_KEY=sk-...
OPENAI_API_KEY=sk-...
```

API key 不在 config.json 中，通过 env 变量名引用。

---

## 5. Core Package — Startup Order

```text
src/main.ts (入口)
  │
  ├── 1. Parse CLI arguments (src/bootstrap/cli.ts)
  │     parseArguments(Bun.argv.slice(2)) → BootArguments
  │
  ├── 2. Load .env from sandbox (src/bootstrap/env.ts)
  │     loadEnv(args.sandbox) → process.env
  │
  ├── 3. Load config.json from sandbox (src/bootstrap/config.ts)
  │     loadConfig(args.sandbox) → AppConfig
  │
  ├── 4. Initialize Log System
  │     createLogger(args) → Logger
  │
  ├── 5. Init sandbox workspace (src/bootstrap/agents.ts)
  │     initAtomDir(args.sandbox) → 创建 .atom/ 目录
  │     initAgentsMd(args.sandbox) → 检查/创建 AGENTS.md
  │
  ├── 6. Create RuntimeService (src/services/runtime-service.ts)
  │     new RuntimeService({ mode, port, host, sandbox, apiKey })
  │     → 统一环境信息入口，消除模块级全局变量
  │
  ├── 7. Create services (src/services/)
  │     sm = new ServiceManager()
  │     sm.register("runtime", runtime)
  │     sm.register("agents-compiler", new AgentsCompilerService({ runtime }))
  │     sm.startAll()
  │
  └── 8. Mode dispatch
        ├── "core" → startCore({ port, host, logger, sm })
        ├── "tui"  → startTui(deps)
        └── "full" → startCore + startGateway + startTui
```

**关键变化（v0.3.9）：**
- `setSandbox()` / `setBashSandbox()` 已删除。sandbox 路径通过 `RuntimeService` 的 factory 函数注入到 tools
- `CoreDeps` 精简为 `{ port, host, logger, sm }`，sandbox/apiKey/getCompiledPrompt 全通过 `sm.get("runtime")` 获取
- tools 改为工厂函数：`createAllTools(sandbox)` → `partitionTools(all)` 拆分 basic/advanced

### Startup Code Template

```typescript
// src/packages/core/src/server.ts

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

## 6. Entry Points

```text
src/main.ts                 → 入口：CLI 解析 → config/env 加载 → mode 分发
├── bootstrap/
│   ├── cli.ts             → parseArguments()
│   ├── config.ts          → loadConfig()
│   └── env.ts             → loadEnv()

├── core → src/packages/core/server.ts    → startCore()
├── gateway → src/packages/gateway/src/server.ts  → startGateway()
└── tui → src/packages/tui/src/app.tsx        → startTUI()
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
