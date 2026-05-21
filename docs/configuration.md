# Configuration System

> **Purpose**: How configuration is loaded, validated, and accessed across all packages.
> Single source of truth per package, with clear precedence rules.

---

## 1. Loading Precedence

```text
CLI arguments  >  Environment variables  >  Config file  >  Default values
    --port 3100     $CORE_PORT=3100         core.config.json    port: 3000
```

Every package calls `loadConfig()` at startup. The function:
1. Reads default values from `defaults.ts`
2. Overlays config file (JSON)
3. Overlays `.env` file (via `Bun.env`)
4. Overlays CLI arguments (via `Bun.argv` parsing)
5. Validates final config with Zod schema

---

## 2. Core Config

```typescript
// packages/core/src/config.ts

import { z } from "zod";

const CoreConfigSchema = z.object({
  port: z.number().int().default(3100),
  host: z.string().default("0.0.0.0"),
  logLevel: z.number().int().min(1).max(3).default(1),  // 1=minimal, 2=+debug, 3=+trace
  logFile: z.string().optional(),

  memoryDbPath: z.string().default("./data/memory.db"),
  maxSessions: z.number().int().default(1000),
  taskTimeoutMs: z.number().int().default(120_000),

  replayEnabled: z.boolean().default(false),
  replayMaxEvents: z.number().int().default(10_000),

  transportModel: z.string().default("deepseek/deepseek-chat"),
  transportMaxOutputTokens: z.number().int().default(4096),
});

export type CoreConfig = z.infer<typeof CoreConfigSchema>;

export function loadCoreConfig(): CoreConfig {
  const defaults: CoreConfig = CoreConfigSchema.parse({});

  // Overlay from file
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(require("fs").readFileSync("core.config.json", "utf-8"));
  } catch { /* no config file */ }

  // Overlay from env
  const envConfig = {
    port: Bun.env.CORE_PORT ? parseInt(Bun.env.CORE_PORT) : undefined,
    host: Bun.env.CORE_HOST,
    logLevel: Bun.env.LOG_LEVEL as any,
    transportModel: Bun.env.TRANSPORT_MODEL,
  };

  // Overlay from CLI
  const cliConfig = parseCliArgs();

  // Merge with precedence: default < file < env < cli
  const merged = deepMerge(defaults, fileConfig, envConfig, cliConfig);

  return CoreConfigSchema.parse(merged);
}
```

---

## 3. Gateway Config

```typescript
// packages/gateway/src/config.ts

const GatewayConfigSchema = z.object({
  port: z.number().int().default(3000),
  host: z.string().default("0.0.0.0"),
  coreUrl: z.string().default("http://localhost:3100"),
  jwtSecret: z.string().min(16),

  rateLimitEnabled: z.boolean().default(true),
  rateLimitRequestsPerMin: z.number().int().default(60),
  rateLimitBurst: z.number().int().default(10),

  corsOrigins: z.array(z.string()).default(["*"]),
});
```

---

## 4. TUI Config

```typescript
// packages/tui/src/config.ts

const TuiConfigSchema = z.object({
  coreUrl: z.string().default("ws://localhost:3100"),
  sessionId: z.string().optional(),  // Reconnect to existing session

  theme: z.enum(["dark", "light"]).default("dark"),
  fontSize: z.number().int().default(14),
  maxVisibleLines: z.number().int().default(50),
});
```

---

## 5. CLI Argument Parsing

```typescript
// packages/core/src/cli.ts

export function parseCliArgs(): Partial<CoreConfig> {
  const args = Bun.argv.slice(2);
  const config: Record<string, any> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--port":
        config.port = parseInt(args[++i]);
        break;
      case "--host":
        config.host = args[++i];
        break;
      case "--log-level":
        config.logLevel = parseInt(args[++i]);
        break;
      case "--config":
        // Load alternative config file
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        console.warn(`Unknown argument: ${args[i]}`);
    }
  }

  return config;
}
```

---

## 6. Config Validation Rules

```typescript
// Additional validation beyond Zod schema:

function validateConfig(config: CoreConfig): void {
  if (config.port < 1024 && process.getuid() !== 0) {
    throw new Error(`Port ${config.port} requires root. Use port >= 1024.`);
  }

  if (config.maxSessions < 1) {
    throw new Error("maxSessions must be >= 1");
  }

  if (config.taskTimeoutMs < 1000) {
    throw new Error("taskTimeoutMs must be >= 1000ms");
  }

  // Ensure DB directory exists
  const dbDir = path.dirname(config.memoryDbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}
```

---

## 7. Accessing Config at Runtime

```typescript
// Config is loaded ONCE at startup and passed down via constructor injection.
// NEVER import config directly in element/service code.

// BAD:
import { config } from "../config";

// GOOD:
class MyService {
  #config: CoreConfig;
  constructor(config: CoreConfig) {
    this.#config = config;
  }
}

// For convenience, create a typed config context:
type AppContext = {
  config: CoreConfig;
  logger: Logger;
  toolRegistry: ToolRegistry;
  sessionStore: SessionStore;
};

// Bootstrap creates AppContext, passes to all components.
```

---

## 8. Secrets Management

```text
# Secrets NEVER go in config files or code.

# Provider:
.env file (gitignored)
Environment variables (DOCKER_SECRET, systemd EnvironmentFile)
Vault / cloud secret manager (production)

# Example .env:
CORE_PORT=3100
DEEPSEEK_API_KEY=sk-xxx
OPENAI_API_KEY=sk-xxx
GATEWAY_JWT_SECRET=supersecret-min-16-chars

# .gitignore:
.env
*.config.json
data/
```

---

## 9. Config Hot Reload (Future)

```typescript
// Some config values can be changed at runtime without restart:

const HOT_RELOADABLE_KEYS = [
  "logLevel",
  "replayEnabled",
  "transportMaxOutputTokens",
  "taskTimeoutMs",
] as const;

// Implementation: watch config file, validate, apply changes
// NOT in Phase 1. Marked as future enhancement.
```
