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
│   ├── services/             # App-level services (Memory, Skill, Network)
│   │   └── network/          # Shared domain scheduling + WebFetch
│   ├── assets/               # Static assets (bundled with app)
│   │   └── prompts/
│   │       └── base_system_prompt.md  # System safety prompt
│   └── packages/
│       ├── shared/           # Shared types, pipeline core, log system
│       ├── core/             # Core HTTP + WebSocket server, task engine
│       ├── config-tui/       # OpenTUI wizard: first-run setup + config editor (subprocess)
│       ├── gateway/          # Platform client gateway (secret auth + client manager)
│       └── tui/              # Terminal UI application (chat)
│
├── sandbox/                   # Runtime workspace directory (gitignored)
│   ├── config.json           # Model/TUI/Gateway config
│   ├── .env                  # API keys (gitignored)
│   ├── .atom/                # Agent runtime data
│   │   ├── installed         # First-run marker (empty file)
│   │   ├── memory/           # Memory service data
│   │   └── compiled_prompts/ # Cached compiled prompts
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
    │   ├── elements/index.ts
    │   │   /* 9 elements:
    │   │    * collect-prompts (source)
    │   │    * load-system-prompt (transform)
    │   │    * fetch-agents-prompt (transform)
    │   │    * collect-context (transform)
    │   │    * format-system-messages (transform)
    │   │    * format-user-messages (transform)
    │   │    * stream-llm (transform)
    │   │    * check-follow-up (boundary)
    │   │    * finalize (sink)
    │   │    */
    ├── prediction/
    │   └── index.ts
    ├── follow-up/
    │   ├── index.ts
    │   └── elements/
    ├── follow-up-evaluator/
    │   ├── index.ts
    │   └── elements/
    ├── context-compress/
    │   ├── index.ts
    │   └── elements/
    ├── post-conversation/
    │   ├── index.ts
    │   └── elements/
    └── shared/
        ├── index.ts
        └── token-ratio.ts
```

## 4. Package: `config-tui`

```text
src/packages/config-tui/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # export { startWizard }
    ├── app.tsx               # startWizard: OpenTUI renderer lifecycle
    ├── wizard-logic.ts       # Single-file pure logic (types/pending state machine/commit/load/parsers)
    ├── wizard-logic.test.ts
    ├── theme.tsx             # Self-contained theme system (8 palettes + ThemeProvider)
    ├── modal/                # Self-contained Modal primitives (list nav + action bar + Esc)
    └── components/           # WizardApp / MenuModal (left menu + right details, 1:1) / Providers
                              # ApiKey / Models / Profiles / Theme / Gateway / Project / Confirm
```

Launched by `src/main.ts` (`--wizard` early-exit branch) and by
`src/bootstrap/first-run.ts` via `Bun.spawn` for first-run detection.
It does not import any code from `@atom-neo/tui` — the wizard UI is fully
self-contained; responsibilities of the two packages stay independent.
It participates in the root `bun run --workspaces build` contract with
`typecheck: tsc --noEmit` and `build: tsc`.

### Workspace Dependency Version Policy

Dependencies shared by the root application and workspace packages must stay on
one compatible version line. The current baseline is `ai` 7.0.79 with
`@ai-sdk/deepseek` 3.0.32 and `@ai-sdk/mcp` 2.0.37, plus OpenTUI 0.5.8.
Workspace manifests may declare these dependencies directly, but must not
introduce a second major or minor line.

## 5. Package: `gateway`

```text
src/packages/gateway/
├── package.json
├── tsconfig.json
├── index.ts
├── server.ts
├── config.ts
├── auth/
│   └── secret.ts
└── client-manager/
    └── index.ts
```

## 6. Package: `tui`

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

## 7. Workspace Root

```json
// package.json (root)
{
  "name": "atom-neo",
  "private": true,
  "workspaces": [
    "src/packages/shared",
    "src/packages/core",
    "src/packages/config-tui",
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

## 8. Package Dependencies

```text
shared/
  Dependencies: zod
  Depended on by: core, gateway, tui

core/
  Dependencies: shared, ai, @ai-sdk/deepseek, @ai-sdk/openai
  Depended on by: (none, loaded by main.ts)

config-tui/
  Dependencies: @opentui/core, @opentui/react, react
  Depended on by: (none, launched as subprocess/early-exit by main.ts)

gateway/
  Dependencies: shared
  Depended on by: (none, standalone service)

tui/
  Dependencies: shared, react, react-dom
  Depended on by: (none, standalone application)
```

## 9. Runtime Directories

```text
sandbox/                        # 工作目录（--sandbox 或默认 CWD）
├── config.json                # Model/TUI/Gateway 配置
├── .env                       # API Keys（gitignored）
├── AGENTS.md                  # 项目开发指引（Agent 行为规范）
├── .atom/                     # Agent 运行时数据目录
│   ├── installed              # 首次运行标记（空文件）
│   ├── memory/                # 记忆服务数据
│   │   └── memory.db          # 长期记忆数据库（正文、图谱、FTS5）
│   ├── compiled_prompts/      # 缓存编译后提示词
│   └── agents_meta.json       # 编译元数据
├── logs/                      # 日志输出目录
│   └── app.log
└── ...                        # 用户项目文件
```

**隔离规则**：Agent 所有操作默认限定在 SANDBOX 内。访问外部目录需用户授权。

## 相关文档

| 文档 | 说明 |
|------|------|
| [architecture.md](./architecture.md) | 模块在系统架构中的角色 |
| [bootstrap.md](./bootstrap.md) | 入口点和启动顺序 |
| [sandbox.md](../subsystems/sandbox.md) | 运行时目录结构 |
