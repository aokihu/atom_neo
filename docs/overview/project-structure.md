# Project Structure

> **Purpose**: Complete directory layout and module responsibility map.
> All source code lives under `src/` — package directly from this directory.

---

## 1. Top-Level Layout

```text
atom_neo/
├── package.json              # Workspace root
├── tsconfig.json             # Base TypeScript config
├── tsconfig.docs.json        # Docs-only typecheck config
├── .gitignore
├── .env.example              # Template for sandbox/.env
│
├── src/                      # All source code
│   ├── main.ts               # Application entry point
│   ├── version.ts            # App version
│   ├── bootstrap/            # App startup layer (CLI/config/env/menu/backup)
│   ├── services/             # App-level services (Memory, Skill, Network, Agents)
│   │   └── network/          # Shared domain scheduling + WebFetch
│   ├── assets/               # Static assets (bundled with app)
│   │   └── prompts/          # AGENTS.md compiler/template prompts
│   └── packages/
│       ├── shared/           # Config contract, types, pipeline core, log, utils
│       ├── core/             # Core HTTP + WebSocket server, task engine, pipelines
│       ├── config-tui/       # OpenTUI wizard: first-run setup + config editor
│       ├── gateway/          # Platform client gateway (secret auth + client manager)
│       └── tui/              # Terminal UI application (chat)
│
├── tests/                    # Cross-package/e2e tests
├── sandbox/                  # Runtime workspace directory (gitignored)
│   ├── config.json           # Model/TUI/Gateway config
│   ├── .env                  # API keys (gitignored)
│   ├── .atom/                # Agent runtime data
│   │   ├── installed         # First-run marker (empty file)
│   │   ├── memory/           # Memory service data
│   │   └── compiled_prompts/ # Cached compiled prompts
│   └── logs/                 # Log output
│
├── clients/                  # Optional platform client reference implementations
├── scripts/                  # Maintenance scripts (check-docs.ts, release helpers)
│
└── docs/                     # Markdown docs + local renderer
    ├── index.md              # Documentation index
    ├── package.json          # Scope marker: type=module for Node ESM
    ├── server.ts             # Markdown → HTML HTTP server (Bun/Node)
    ├── server.test.ts        # Render/resolve/server tests
    ├── assets/
    │   └── docs.css          # Dark theme + highlight.js token styles
    ├── records/              # Historical validation/experiment records
    ├── overview/
    ├── standards/
    ├── subsystems/
    ├── core/
    ├── pipelines/
    ├── communication/
    └── code-review-2026-11-10/
```

> 文档只维护 Markdown；`docs/server.ts` 在请求时渲染 HTML，不再保留旧 React/JSX 文档站页面。

## 2. Package: `shared`

```text
src/packages/shared/
├── package.json
├── tsconfig.json
├── index.ts              # Barrel exports
├── config/               # Single config contract (schema/defaults/presets)
│   ├── index.ts
│   ├── schema.ts
│   ├── providers.ts
│   ├── client.ts
│   └── theme.ts
├── constants/
│   └── events.ts         # BusEvents / WsMessages / failure codes
├── types/
│   ├── index.ts
│   ├── task.ts
│   ├── intent.ts
│   ├── memory.ts
│   ├── tool.ts
│   ├── pipeline.ts
│   ├── session.ts
│   ├── skill.ts
│   ├── context.ts
│   ├── network.ts
│   ├── schedule.ts
│   ├── hook.ts
│   └── primitive.ts
├── pipeline/
│   ├── index.ts
│   ├── base-element.ts
│   ├── runner.ts          # exported but not wired into TaskEngine
│   ├── event-bus.ts
│   ├── types.ts
│   └── constants.ts
├── prompts/               # Prompt Registry + language/model variants
├── protocol.ts            # WebSocket protocol types
├── log/                   # Logger / sinks
└── utils/
    ├── index.ts
    ├── error.ts
    ├── string.ts
    ├── string-width.ts
    ├── timing.ts
    ├── process.ts         # spawnProcess / ProcessHandle
    ├── env-file.ts        # .env parse/upsert/merge
    ├── fs.ts              # writeFileAtomic
    ├── id.ts              # createId
    ├── number.ts          # clamp/parsePortValue
    ├── sanitize.ts
    ├── memory-search.ts
    └── admin-auth.ts
```

## 3. Package: `core`

```text
src/packages/core/
├── package.json
├── tsconfig.json
├── index.ts              # Barrel exports
├── server.ts             # startCore(): HTTP + WebSocket server
├── constants.ts          # Token/context defaults
├── task-engine.ts
├── task-queue.ts
├── task-factory.ts
├── url-path.ts
│
├── api/
│   ├── tasks.ts
│   ├── health.ts
│   └── config.ts
│
├── ws/
│   ├── handler.ts
│   ├── broadcaster.ts
│   ├── transport-bridge.ts
│   └── decision-bridge.ts
│
├── pipeline/
│   ├── registry.ts
│   ├── builder.ts
│   └── manager.ts
│
├── session/
│   ├── context.ts
│   ├── store.ts
│   ├── persistence-service.ts
│   ├── execution-budget.ts
│   ├── message-policy.ts
│   └── types.ts
│
├── context/
│   ├── compiler.ts
│   └── context-service.ts
│
├── decision/
│   ├── choose.ts
│   └── jev-client.ts
│
├── hooks/
│   └── hook-manager.ts
│
├── task/
│   └── internal-task-orchestrator.ts
│
├── skills/
│   └── types.ts
│
├── tools/
│   ├── registry.ts
│   ├── executor.ts
│   ├── permissions.ts
│   ├── governance.ts
│   ├── guard.ts
│   ├── outcome.ts
│   ├── bootstrap.ts
│   ├── mcp-manager.ts
│   ├── schedule-service.ts
│   ├── tool-record-store.ts
│   └── builtin/
│       ├── fs.ts
│       ├── shell.ts
│       ├── memory.ts
│       ├── history.ts
│       ├── intent.ts
│       ├── schedule.ts
│       ├── skill.ts
│       ├── todowrite.ts
│       ├── webfetch.ts
│       ├── websearch.ts
│       └── tool-records.ts
│
├── replay/
│   ├── recorder.ts       # exported, not wired
│   └── player.ts         # exported, not wired
│
└── pipelines/
    ├── index.ts
    ├── conversation/
    │   ├── index.ts
    │   └── elements/
    │       /* 当前主链 8 个：
    │        * collect-prompts (source)
    │        * record-context (transform)
    │        * apply-source-context (transform)
    │        * collect-context (transform)
    │        * stream-llm (transform)
    │        * token-ratio (boundary, from pipelines/shared)
    │        * check-follow-up (boundary)
    │        * finalize (sink)
    │        *
    │        * 兼容注册但不在主链：
    │        * load-system-prompt / fetch-agents-prompt
    │        * format-system-messages / format-user-messages
    │        * inject-skill-context
    │        */
    ├── prediction/          # 3 elements
    ├── follow-up/           # 2-element lightweight pipeline
    ├── follow-up-evaluator/ # 3 elements
    ├── context-compress/    # 4 elements (含 token-ratio)
    ├── post-conversation/   # 3 elements
    └── shared/              # jev-element / token-ratio / progress-* / trigram / llm
```

## 4. Package: `config-tui`

```text
src/packages/config-tui/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # export { startWizard }
    ├── app.tsx               # startWizard: OpenTUI renderer lifecycle
    ├── wizard-logic.ts       # Pending state machine / commit / load / parsers
    ├── theme.tsx             # ThemeProvider + palettes
    ├── modal/                # Self-contained Modal primitives
    └── components/           # WizardApp / Menu / Provider / Model / Theme / Confirm
```

The wizard runs as a subprocess launched by `src/main.ts` (`--wizard` early-exit
branch) and by `src/bootstrap/first-run.ts` via shared `spawnProcess`.
It consumes shared config presets (`@atom-neo/shared`) but does not import the
chat TUI or Core. It participates in the root `bun run --workspaces build`
contract with `typecheck: tsc --noEmit` and `build: tsc`.

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
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── config.ts
│   ├── auth/
│   │   └── secret.ts
│   └── client-manager/
│       └── index.ts
```

## 6. Package: `tui`

```text
src/packages/tui/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── app.tsx                 # TUI entrypoint / renderer lifecycle
│   ├── theme.ts                # Theme palettes + syntax style
│   ├── types.ts                # View-model types
│   ├── client/
│   │   └── ws-client.ts        # WebSocket event client
│   ├── hooks/
│   │   └── useChat.ts          # Client → store bindings + send/cancel
│   ├── stores/
│   │   ├── chat.ts             # Zustand chat state
│   │   ├── inputHistory.ts
│   │   └── copied.ts
│   └── components/
│       ├── App.tsx             # Root layout / modal routing
│       ├── ChatView.tsx
│       ├── InputBar.tsx
│       ├── Sidebar.tsx
│       ├── RuntimeSidebar.tsx
│       ├── SettingsModal.tsx
│       ├── ToolMessageBox.tsx
│       └── modal/              # Modal / ModalActionBar / types
```

## 7. Workspace Root

```json
// package.json (root)
{
  "name": "atom-neo",
  "version": "1.22.5",
  "engines": { "node": ">=24", "bun": ">=1.4" },
  "workspaces": [
    "src/packages/shared",
    "src/packages/core",
    "src/packages/config-tui",
    "src/packages/gateway",
    "src/packages/tui"
  ],
  "scripts": {
    "dev": "bun run src/main.ts --sandbox ./sandbox ...",
    "test": "bun test",
    "typecheck": "bun run --workspaces typecheck",
    "build": "bun run --workspaces build",
    "docs": "bun run docs/server.ts",
    "docs:check": "bun run scripts/check-docs.ts",
    "docs:typecheck": "tsc -p tsconfig.docs.json"
  }
}
```

## 8. Package Dependencies

```text
shared/
  Dependencies: zod, string-width
  Depended on by: core, gateway, config-tui, tui

core/
  Dependencies: shared, ai, @ai-sdk/deepseek, @ai-sdk/mcp, @toon-format/toon, croner, zod
  Depended on by: (none, loaded by main.ts)

config-tui/
  Dependencies: shared, @opentui/core, @opentui/react, react
  Depended on by: (none, launched as subprocess/early-exit by main.ts)

gateway/
  Dependencies: shared, zod
  Depended on by: (none, standalone service)

tui/
  Dependencies: shared, react, zustand, @opentui/core, @opentui/react
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
