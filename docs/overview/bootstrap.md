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
  --log console|pipe|file 日志输出模式（可叠加；不设置则无日志输出）
  --log-level debug|info|warn|error  最小日志级别（默认 debug）
  --log-ignore <level>    忽略指定级别的日志（可重复）
  --log-file <path>       日志文件路径（--log=file 时必需）
  --log-pipepath <path>   命名管道路径（--log=pipe 时必需，需为有效 FIFO）
```

**日志规则：**
- `--log` 未设置 → 无任何日志输出（包括 console.log 也不会调用）
- `--log=console` → 仅 `--mode core` 时生效，其他模式静默忽略
- `--log=pipe` → 需要 `--log-pipepath` 指向有效的命名管道（FIFO），否则静默回退
- `--log=file` → 需要 `--log-file` 指定输出文件路径，否则静默回退
- 多个 `--log` 可叠加：`--log=pipe --log=file`
- `--log-level` 和 `--log-ignore` 控制日志级别过滤，与输出模式独立

---

## 3. Config File (`$SANDBOX/config.json`)

```jsonc
{
  "version": 2,
  "theme": "dark",
  "providerProfiles": {
    "advanced": "deepseek/deepseek-v4-flash",
    "balanced": "deepseek/deepseek-v4-flash",
    "basic": "deepseek/deepseek-v4-pro"
  },
  "providers": {
    "deepseek": {
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "models": ["deepseek-v4-flash", "deepseek-v4-pro"],
      "baseUrl": "https://api.deepseek.com/v1",
      "thinking": "disabled",
      "contextLimit": 131072
    }
  },
  "transport": { "maxOutputTokens": 4096 },
  "gateway": { "port": 3000, "jwtSecret": "..." },
  "tui": { "theme": "dark" },
  "permission": {
    "whitelist": ["/home/user/other-project", "/tmp/shared"]
  }
}
```

不含 server 配置（port/host 走 CLI）。文件缺失时使用默认值。完整 schema 见 [configuration.md](../subsystems/configuration.md)。

---

## 4. Environment (`$SANDBOX/.env`)

```bash
DEEPSEEK_API_KEY=sk-...
OPENAI_API_KEY=sk-...
```

API key 不在 config.json 中，通过 env 变量名引用。

---

## 5. First-Run Detection

启动时检查 `$SANDBOX/.atom/installed` 标记文件是否存在：

```typescript
// src/bootstrap/first-run.ts
export async function isFirstRun(sandboxPath: string): Promise<boolean> {
  return !(await Bun.file(`${sandboxPath}/.atom/installed`).exists());
}
```

| 检测结果 | 行为 |
|---------|------|
| `.atom/installed` 不存在 | 通过 `Bun.spawn` 自孵化 Ink 安装向导子进程，完成 Provider/Model/Theme 配置 |
| `.atom/installed` 已存在 | 跳过向导，直接进入正常启动流程 |

完整规格详见 [first-run-wizard.md](../subsystems/first-run-wizard.md)。

---

## 6. Core Package — Startup Order

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
  ├── 5. First-Run Detection (src/bootstrap/first-run.ts)
  │     isFirstRun(args.sandbox) → 检查 .atom/installed
  │     ├─ 不存在 → spawnWizard() → 自孵化子进程 (process.execPath + --wizard)
  │     │            → wizard exit(0) → markInstalled() → 重新加载 config/env
  │     └─ 已存在 → 跳过
  │
  ├── 6. Init sandbox workspace (src/bootstrap/agents.ts)
  │     initAtomDir(args.sandbox) → 创建 .atom/ 目录
  │     initAgentsMd(args.sandbox) → 检查/创建 AGENTS.md
  │
  ├── 7. Create RuntimeService (src/services/runtime-service.ts)
  │     new RuntimeService({ mode, port, host, sandbox, apiKey })
  │     → 统一环境信息入口，消除模块级全局变量
  │
  ├── 8. Create services (src/services/)
  │     sm = new ServiceManager()
  │     sm.register("runtime", runtime)
  │     sm.register("agents-compiler", new AgentsCompilerService({ runtime }))
  │     sm.startAll()
  │
  └── 9. Mode dispatch
        ├── "core" → startCore({ port, host, logger, sm })
        ├── "tui"  → startTui(deps)
        └── "full" → startCore + startGateway + startTui
```

**历史变化：**
- `setSandbox()` / `setBashSandbox()` 已删除。sandbox 路径通过 `RuntimeService` 的 factory 函数注入到 tools
- `CoreDeps` 精简为 `{ port, host, logger, sm }`，sandbox/apiKey/getCompiledPrompt 全通过 `sm.get("runtime")` 获取
- tools 改为工厂函数：`createAllTools(sandbox)` 创建全部工具，启动时一次性传递给 conversation pipeline

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

## 7. Gateway Package — Startup Order

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

## 8. TUI Package — Startup Order

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

## 9. Graceful Shutdown (All Packages)

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

  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

---

## 10. Dependency Graph

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

## 11. Entry Points

```text
src/main.ts                 → 入口：CLI 解析 → config/env 加载 → mode 分发
├── bootstrap/
│   ├── cli.ts             → parseArguments()
│   ├── config.ts          → loadConfig()
│   ├── env.ts             → loadEnv()
│   ├── first-run.ts       → isFirstRun(), runFirstRunWizard()
│   └── agents.ts          → initAtomDir(), initAgentsMd()

├── core → src/packages/core/server.ts    → startCore()
├── setup-wizard → src/packages/setup-wizard/src/main.tsx  → Ink 子进程向导
├── gateway → src/packages/gateway/src/server.ts  → startGateway()
└── tui → src/packages/tui/src/app.tsx        → startTUI()
```

---

## 12. Health Check Flow

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
      version: "1.8.4"
    }
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [configuration.md](../subsystems/configuration.md) | 配置加载机制和 JSON Schema |
| [sandbox.md](../subsystems/sandbox.md) | 沙箱初始化和 `.atom/` 目录结构 |
| [first-run-wizard.md](../subsystems/first-run-wizard.md) | 首次运行向导完整规格 |
