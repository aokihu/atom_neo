# Project Structure

> **Purpose**: Complete directory layout and module responsibility map.
> All source code lives under `src/` — package directly from this directory.

---

## 1. Top-Level Layout

```text
atom_neo/
├── package.json              # Workspace root
├── tsconfig.json              # Base TypeScript config
├── .gitignore
├── .env.example               # Template for sandbox/.env
│
├── src/                       # All source code
│   ├── main.ts               # Application entry point
│   ├── bootstrap/            # App startup layer
│   ├── assets/               # Static assets (bundled with app)
│   │   └── prompts/
│   │       └── base_system_prompt.md  # System safety prompt
│   └── packages/
│       ├── shared/           # Shared types, pipeline core, log system
│       ├── core/             # Core HTTP + WebSocket server, task engine
│       ├── gateway/          # External gateway (auth, permission, proxy)
│       └── tui/              # Terminal UI application
│
├── sandbox/                   # Runtime workspace directory (gitignored)
│   ├── config.json           # Model/TUI/Gateway config
│   ├── .env                  # API keys (gitignored)
│   └── logs/                 # Log output
│
└── docs/                      # Development documentation
```

## 2. Package: `shared`

```text
src/packages/shared/
├── package.json
├── tsconfig.json
├── index.ts              # Barrel exports
├── types/
│   ├── index.ts
│   ├── task.ts
│   ├── intent.ts
│   ├── memory.ts
│   ├── tool.ts
│   ├── pipeline.ts
│   ├── session.ts
│   ├── config.ts
│   └── primitive.ts
├── pipeline/
│   ├── index.ts
│   ├── base-element.ts
│   ├── runner.ts
│   ├── event-bus.ts
│   ├── types.ts
│   └── constants.ts
├── protocol.ts
├── log/
│   ├── index.ts
│   ├── logger.ts
│   ├── log-hub.ts
│   ├── types.ts
│   └── sinks/
│       ├── stdout.ts
│       ├── file.ts
│       └── pipe.ts
└── utils/
    ├── index.ts
    ├── error.ts
    ├── string.ts
    └── timing.ts
```

## 3. Package: `core`

```text
src/packages/core/
├── package.json
├── tsconfig.json
├── index.ts              # Barrel exports
├── server.ts             # startCore(): HTTP + WebSocket server
│
├── api/
│   ├── tasks.ts
│   ├── health.ts
│   └── middleware/
│
├── ws/
│   ├── handler.ts
│   └── broadcaster.ts
│
├── task-engine.ts
├── task-queue.ts
├── task-factory.ts
│
├── pipeline/
│   ├── registry.ts
│   ├── builder.ts
│   ├── manager.ts
│   └── runner.ts
│
├── session/
│   ├── context.ts
│   └── store.ts
│
├── tools/
│   ├── registry.ts
│   ├── executor.ts
│   ├── permissions.ts
│   ├── bootstrap.ts
│   └── builtin/
│       ├── fs.ts
│       ├── bash.ts
│       └── memory.ts
│
├── replay/
│   ├── recorder.ts
│   └── player.ts
│
└── pipelines/
    ├── index.ts
    ├── conversation/
    │   ├── index.ts
    │   ├── types.ts
        │   └── elements/index.ts
        │       /* 7 elements:
        │        * collect-prompts (source)
        │        * load-system-prompt (transform)
        │        * collect-context (transform)
        │        * format-messages (transform)
        │        * stream-llm (transform)
        │        * check-follow-up (boundary)
        │        * finalize (sink)
        │        */
    ├── prediction/
    │   └── index.ts
    └── follow-up/
        └── index.ts
```

## 4. Package: `gateway`

```text
src/packages/gateway/
├── package.json
├── tsconfig.json
├── index.ts
├── server.ts
├── config.ts
├── auth/
│   └── jwt.ts
├── permissions/
│   └── checker.ts
├── ratelimit/
│   └── limiter.ts
└── proxy/
    └── core-proxy.ts
```

## 5. Package: `tui`

```text
src/packages/tui/
├── package.json
├── tsconfig.json
├── index.ts
├── app.tsx
├── client/
│   └── ws-client.ts
├── session/
│   └── manager.ts
├── renderer/
│   ├── stream.ts
│   └── tools.ts
└── views/
    ├── chat.tsx
    ├── toolbar.tsx
    └── status.tsx
```

## 6. Workspace Root

```json
// package.json (root)
{
  "name": "atom-neo",
  "private": true,
  "workspaces": [
    "src/packages/shared",
    "src/packages/core",
    "src/packages/gateway",
    "src/packages/tui"
  ],
  "scripts": {
    "dev": "bun run --filter @atom-neo/core dev",
    "dev:all": "bun run --workspaces dev",
    "test": "bun test",
    "typecheck": "bun run --workspaces typecheck",
    "build": "bun run --workspaces build"
  }
}
```

## 7. Package Dependencies

```text
shared/
  Dependencies: zod
  Depended on by: core, gateway, tui

core/
  Dependencies: shared, ai, @ai-sdk/deepseek, @ai-sdk/openai
  Depended on by: (none, loaded by main.ts)

gateway/
  Dependencies: shared
  Depended on by: (none, standalone service)

tui/
  Dependencies: shared, react, react-dom
  Depended on by: (none, standalone application)
```

## 8. Runtime Directories

```text
sandbox/                     # Workspace directory (gitignored)
├── config.json              # Model/TUI/Gateway config
├── .env                     # API keys (DEEPSEEK_API_KEY, etc.)
└── logs/                    # Log output directory
    └── app.log
```
