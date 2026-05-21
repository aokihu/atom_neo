# Project Structure

> **Purpose**: Complete directory layout and module responsibility map.
> This is the blueprint for creating the monorepo from scratch.

---

## 1. Top-Level Layout

```text
atom_neo/
├── package.json              # Workspace root (npm workspaces)
├── tsconfig.json              # Base TypeScript config
├── bunfig.toml               # Bun configuration
├── .gitignore
├── .env.example
│
├── packages/
│   ├── shared/               # Shared types, pipeline core, log system
│   ├── core/                 # Core HTTP + WebSocket server, task engine
│   ├── gateway/              # External gateway (auth, permission, proxy)
│   └── tui/                  # Terminal UI application
│
├── docs/                     # Development documentation
│   ├── architecture.md
│   ├── architecture.html
│   ├── coding-conventions.md
│   ├── naming-conventions.md
│   ├── element-design.md
│   ├── protocol.md
│   ├── pipeline-builder.md
│   ├── tool-plugin.md
│   ├── session-context.md
│   ├── type-system.md
│   ├── testing.md
│   └── project-structure.md
│
└── scripts/                  # Build, deploy, CI scripts
    └── bootstrap.ts
```

## 2. Package: `shared`

```text
packages/shared/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Barrel exports
    ├── types/
    │   ├── index.ts
    │   ├── task.ts           # TaskItem, TaskState, TaskPayload
    │   ├── intent.ts         # IntentRequest types
    │   ├── memory.ts         # Memory types
    │   ├── tool.ts           # ToolDefinition, ToolResult
    │   ├── pipeline.ts       # PipelineResult, PipelineEventMap, FlowState base
    │   ├── session.ts        # SessionContext types
    │   ├── config.ts         # Configuration types
    │   └── primitive.ts      # UUID, ISOTimeString
    ├── pipeline/
    │   ├── index.ts
    │   ├── base-element.ts   # Abstract BaseElement
    │   ├── runner.ts         # PipelineRunner
    │   ├── event-bus.ts      # PipelineEventBus
    │   ├── types.ts          # Pipeline, PipelineDefinition, PipelineElementKind
    │   └── constants.ts      # READY_TO_FINALIZE, etc.
    ├── protocol.ts           # WebSocket event type definitions
    ├── log/                  # Log system (Hub-and-Sink)
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
        ├── error.ts          # Error normalization
        ├── string.ts         # String utilities
        └── timing.ts         # sleep, debounce, etc.
```

## 3. Package: `core`

```text
packages/core/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Barrel exports
    ├── server.ts             # HTTP + WebSocket server (Bun.serve)
    │
    ├── api/
    │   ├── tasks.ts          # POST /api/tasks, GET /api/tasks/:id, DELETE /api/tasks/:id
    │   ├── health.ts         # GET /api/health, GET /api/metrics
    │   └── middleware/
    │       ├── logger.ts
    │       └── error.ts
    │
    ├── ws/
    │   ├── handler.ts        # WebSocket upgrade + message routing
    │   └── broadcaster.ts    # Fan-out events to connected clients
    │
    ├── task-engine.ts        # Event-driven task activation (replaces runloop)
    ├── task-queue.ts         # Priority task queue
    ├── task-factory.ts       # createTaskItem, createContinuationTask, etc.
    │
    ├── pipeline/
    │   ├── registry.ts       # ElementRegistry
    │   ├── builder.ts        # PipelineBuilder DSL
    │   ├── manager.ts        # PipelineManager (runtime pipeline instances)
    │   └── runner.ts         # Re-exports PipelineRunner from shared
    │
    ├── session/
    │   ├── context.ts        # SessionContext class
    │   ├── store.ts          # SessionStore (Map-based, in-memory)
    │   └── mcp-connections.ts # Per-session MCP connection management
    │
    ├── runtime/              # Runtime subsystems (split from v1 Runtime)
    │   ├── orchestrator.ts   # Conversation orchestrator
    │   ├── intent-policy.ts  # Intent policy resolution
    │   ├── tool-coordinator.ts # Tool execution coordinator
    │   ├── memory-coordinator.ts # Memory management
    │   └── prompt/
    │       ├── system.ts     # System prompt export
    │       └── user.ts       # User prompt export
    │
    ├── tools/
    │   ├── registry.ts       # ToolRegistry
    │   ├── executor.ts       # Tool execution (delegates to ToolDefinition.execute)
    │   ├── permissions.ts    # Permission filtering
    │   ├── bootstrap.ts      # Register all builtin tools at startup
    │   ├── builtin/
    │   │   ├── fs.ts         # read, write, ls, grep, tree, cp, mv
    │   │   ├── bash.ts       # Shell command execution
    │   │   └── memory.ts     # search_memory, save_memory, traverse_memory, etc.
    │   └── adapters/
    │       ├── mcp-tool.ts       # MCP tool → ToolDefinition adapter
    │       ├── mcp-resource.ts   # MCP resource → ToolDefinition adapter
    │       └── mcp-transport.ts  # MCP stdio/SSE transport
    │
    ├── memory/
    │   ├── service.ts        # MemoryService (graph + FTS5)
    │   ├── storage.ts        # Bun SQLite persistence
    │   └── traversal.ts      # Graph traversal algorithms
    │
    ├── replay/
    │   ├── recorder.ts       # Pipeline event recorder
    │   └── player.ts         # Pipeline event player
    │
    └── pipelines/            # Pipeline definitions
        ├── index.ts
        ├── conversation/
        │   ├── index.ts      # Pipeline builder definition
        │   ├── types.ts      # FlowState + Mode enum
        │   └── elements/
        │       ├── export-prompts.element.ts
        │       ├── transform-prompts.element.ts
        │       ├── transform-output.element.ts
        │       ├── parse-intents.element.ts
        │       ├── execute-intents.element.ts
        │       ├── apply-execution.element.ts
        │       └── finalize.element.ts
        ├── prediction/
        │   ├── index.ts
        │   ├── types.ts
        │   └── elements/
        └── follow-up/
            ├── index.ts
            ├── types.ts
            └── elements/
```

## 4. Package: `gateway`

```text
packages/gateway/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── server.ts            # HTTP server (Bun.serve)
    ├── auth/
    │   ├── jwt.ts           # JWT verification
    │   └── middleware.ts    # Auth middleware
    ├── permission/
    │   ├── checker.ts       # Permission evaluation
    │   └── roles.ts         # Role + permission level definitions
    ├── ratelimit/
    │   └── limiter.ts       # Token bucket rate limiter
    └── proxy/
        └── core-proxy.ts    # HTTP proxy to Core
```

## 5. Package: `tui`

```text
packages/tui/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── app.tsx              # TUI application entry
    ├── session/
    │   └── manager.ts       # Session lifecycle
    ├── client/
    │   └── ws-client.ts     # WebSocket client (connects to Core)
    ├── renderer/
    │   ├── stream.ts        # Streaming text renderer
    │   └── tools.ts         # Tool call display
    └── views/
        ├── chat.tsx         # Chat view
        ├── toolbar.tsx      # Tool execution toolbar
        └── status.tsx       # Status bar
```

## 6. Workspace Root

```json
// package.json (root)
{
  "name": "atom-neo",
  "private": true,
  "workspaces": [
    "packages/shared",
    "packages/core",
    "packages/gateway",
    "packages/tui"
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
  Dependencies: zod, radashi
  Depended on by: core, gateway, tui

core/
  Dependencies: shared, ai, @ai-sdk/deepseek, @ai-sdk/openai
  Depended on by: (none, standalone HTTP service)

gateway/
  Dependencies: shared, jose (for JWT)
  Depended on by: (none, standalone HTTP service)

tui/
  Dependencies: shared, @opentui/react, react
  Depended on by: (none, standalone application)
```

## 8. Environment Variables

```bash
# .env.example

# Core
CORE_PORT=3100
CORE_HOST=0.0.0.0
LOG_LEVEL=debug

# Gateway
GATEWAY_PORT=3000
CORE_URL=http://localhost:3100
JWT_SECRET=change-me

# LLM
DEEPSEEK_API_KEY=sk-...
OPENAI_API_KEY=sk-...
TRANSPORT_MODEL=deepseek/deepseek-chat

# Memory
MEMORY_DB_PATH=./data/memory.db
```
