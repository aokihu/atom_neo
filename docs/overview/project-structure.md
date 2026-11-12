# Project Structure

> **Purpose**: Complete directory layout and module responsibility map.
> All source code lives under `src/` — package directly from this directory.

---

## 1. Top-Level Layout

```text
atom_neo/
├── package.json              # Workspace root + publishable Node package
├── tsconfig.json             # Shared/base TypeScript config (no runtime types)
├── tsconfig.node.json        # Node production-source typecheck (types: ["node"])
├── tsconfig.docs.json        # Docs-only typecheck config
├── .github/
│   └── workflows/ci.yml      # Two jobs: Bun (full) + Node 26 (smoke/package)
├── .gitignore
├── .env.example              # Template for sandbox/.env
│
├── src/                      # All source code
│   ├── main.ts               # Application entry point
│   ├── version.ts            # App version
│   ├── bootstrap/            # App startup layer (CLI/config/env/menu/backup)
│   ├── services/             # App-level services
│   │   ├── base/             # BaseService, ServiceManager, shared service types
│   │   ├── memory/           # Memory facade, SQLite store, FTS5, ranking, graph
│   │   ├── network/          # Shared domain scheduling + WebFetch
│   │   ├── skill/            # Skill service + SKILL.md parser
│   │   ├── agents/           # Agent definition compiler
│   │   ├── runtime/          # Runtime resource coordination
│   │   └── storage/          # node:sqlite thin wrapper
│   ├── assets/               # Static assets (bundled with app)
│   │   └── prompts/          # AGENTS.md compiler/template prompts
│   └── packages/
│       ├── shared/           # Config contract, types, pipeline core, log, utils
│       ├── core/             # Core HTTP + WebSocket server, task engine, pipelines
│       ├── config-tui/       # OpenTUI wizard: first-run setup + config editor
│       ├── gateway/          # Platform client gateway (secret auth + client manager)
│       ├── tui/              # Terminal UI application (chat)
│       └── tui-kit/          # Shared theme + Modal + form/list primitives
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
├── scripts/                  # Maintenance scripts (check-docs.ts, check-code-size.ts, release helpers)
│   ├── node-smoke/           # Real Node smoke: adapters, Core, TUI import, build
│   └── types/                # Exact type shims for Bun-only modules (Node typecheck)
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
├── http/                  # HttpServer contract + Bun/Node adapters
│   ├── index.ts
│   ├── types.ts
│   ├── detect.ts          # ATOM_HTTP_RUNTIME resolution
│   ├── create-http-server.ts
│   ├── bun-http-server.ts # Bun-only; Node typecheck uses bun-http-server.node.ts via moduleSuffixes
│   ├── bun-http-server.node.ts # Type-only Node shim (excluded from shared build)
│   ├── node-http-server.ts
│   └── node-websocket-peer.ts
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
├── server.ts             # startCore(): composition root + lifecycle; transport via HttpServer
├── bootstrap.ts          # Constructs bus/queue/session/tools/MCP/prompt+element registries/pipeline store/schedule/pipeline/WS
├── core-services.ts      # Typed CoreServices contract + startup validation
├── pipeline-factory.ts   # Five pipeline builders + model/token/context/prompt resolver wiring
├── task-lifecycle.ts     # Task Activated/Completed/Failed + chain/idle scheduling
├── http-router.ts        # /api/* + /ws/* route table and requireAdmin
├── mcp-lifecycle.ts      # MCP init/fetch/health/close with stop guard
├── constants.ts          # Token/context defaults
├── task-engine.ts        # Single run loop + queue scheduling/events/cancellation
├── task-queue.ts
├── task-factory.ts
├── url-path.ts
│
├── task/
│   ├── wakeup.ts         # notify-before-wait primitive for the run loop
│   ├── task-runner.ts    # Single-task pipeline execution + immutable FlowState
│   ├── internal-task-orchestrator.ts
│   └── task-submission-service.ts
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
│   ├── registry.ts       # ElementRegistry (per-Core)
│   ├── builder.ts
│   ├── instance-store.ts # PipelineInstanceStore (per-Core task cache)
│   └── manager.ts
│
├── session/
│   ├── context.ts
│   ├── element-session.ts  # PipelineSession / ElementTask / ElementMemory Element 边界
│   ├── store.ts
│   ├── persistence-service.ts
│   ├── session-format.ts   # manifest/JSONL 编解码与路径常量
│   ├── durable-fs.ts       # fsync + atomic rename
│   ├── checkpoint-store.ts # generation 写入/发布/清理
│   ├── history-store.ts    # archive/search/read history
│   ├── message-policy.ts
│   ├── message-projection.ts
│   ├── execution-budget.ts
│   └── types.ts
│
├── context/
│   ├── compiler.ts
│   ├── context-service.ts
│   ├── context-types.ts
│   ├── context-codec.ts
│   ├── bucket-store.ts
│   └── snapshot-manager.ts
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
    │        *
    │        * stream-llm 实现位于 elements/stream/：
    │        * stream-run / loop / step / context / reporting / reporting-events /
    │        * finalize / overflow / model-input / tool-batch(-block/-record) /
    │        * tool-runtime(-mcp) / tool-governance-runtime / tool-result-status
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
    ├── wizard-logic.ts       # Public barrel over wizard/*
    ├── wizard/               # state/prefill/edit/input/commit/reducer/views/overlays
    ├── modal/index.tsx       # Bordered wrapper over @atom-neo/tui-kit Modal
    └── components/           # WizardApp / Menu / Provider / Model / Theme / Confirm
```

The wizard runs as a subprocess launched by `src/main.ts` (`--wizard` early-exit
branch) and by `src/bootstrap/first-run.ts` via shared `spawnProcess`.
It consumes shared config presets (`@atom-neo/shared`), shared theme/Modal
primitives (`@atom-neo/tui-kit`), and does not import the chat TUI or Core.
It participates in the root `bun run --workspaces build` contract with
`typecheck: tsc --noEmit` and `build: tsc`.

### Workspace Dependency Version Policy

Dependencies shared by the root application and workspace packages must stay on
one compatible version line. The current baseline is `ai` 7.0.169 with
`@ai-sdk/deepseek` 3.0.84, `@ai-sdk/mcp` 2.0.96, and the matching
`@ai-sdk/openai` / `@ai-sdk/anthropic` / `@ai-sdk/openai-compatible` releases,
plus OpenTUI 0.8.4.
Workspace manifests may declare these dependencies directly, but must not
introduce a second major or minor line.

## 5. Package: `tui-kit`

```text
src/packages/tui-kit/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Theme, Modal, FieldInput, SelectableRow exports
    ├── runtime-plugin-support.ts # Bun-only OpenTUI plugin guard
    ├── theme.tsx             # Single palette source + ThemeProvider/useTheme/getTheme
    ├── modal/                # Modal / ModalActionBar / types
    └── components/
        ├── FieldInput.tsx    # Single-line modal form field
        └── SelectableRow.tsx # Shared ▸ + selected-background list row
```

Shared by `@atom-neo/tui` and `@atom-neo/config-tui`. The package has no Core or
runtime dependency; it only imports `@atom-neo/shared`, OpenTUI, and React.
It also owns `ensureBunRuntimePluginSupport()`, the guarded Bun-only OpenTUI
runtime-plugin registration used by both TUI entrypoints.

## 6. Package: `gateway`

```text
src/packages/gateway/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── server.test.ts
│   ├── config.ts
│   ├── auth/
│   │   └── secret.ts
│   └── client-manager/
│       ├── README.md
│       ├── index.ts
│       ├── runtime.ts
│       ├── process-state.ts
│       ├── restart-policy.ts
│       ├── health-probe.ts
│       ├── process-supervisor.ts
│       ├── client-command.ts
│       ├── process-termination.ts
│       └── test-helpers.ts
```

## 7. Package: `tui`

```text
src/packages/tui/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── app.tsx                 # TUI entrypoint / renderer lifecycle
│   ├── types.ts                # View-model types (re-exports theme types)
│   ├── client/
│   │   ├── ws-client.ts        # WebSocket event client
│   │   └── ws-client-protocol.ts
│   ├── hooks/
│   │   ├── useChat.ts          # lifecycle + send/cancel
│   │   ├── chat-connection.ts  # TuiClient → store event routing
│   │   ├── chat-messages.ts    # snapshot mapping + send error handling
│   │   └── chat-errors.ts
│   ├── stores/
│   │   ├── chat.ts             # Zustand chat store composition
│   │   ├── chat/               # message/stream/tool/telemetry slices
│   │   ├── inputHistory.ts
│   │   └── copied.ts
│   └── components/
│       ├── App.tsx             # Root layout / modal state
│       ├── app/                # AppModal + modal config
│       ├── ChatView.tsx
│       ├── chat-view-model.ts
│       ├── InputBar.tsx
│       ├── input/              # command menu / history / escape hooks
│       ├── Sidebar.tsx
│       ├── sidebar/            # telemetry sections
│       ├── RuntimeSidebar.tsx
│       ├── runtime/            # runtime sections + step derivation
│       ├── SettingsModal.tsx
│       ├── settings/           # config model + loader hook
│       ├── ToolMessageBox.tsx
│       └── modal/              # Local barrel re-exporting @atom-neo/tui-kit
```

## 8. Workspace Root

```json
// package.json (root)
{
  "name": "atom-neo",
  "version": "1.25.0",
  "type": "module",
  "main": "./dist/node/main.js",
  "exports": {
    ".": {
      "bun": "./dist/node/main.js",
      "node": "./dist/node/main.js",
      "default": "./dist/node/main.js"
    },
    "./package.json": "./package.json"
  },
  "bin": { "atom": "./dist/node/main.js" },
  "files": ["dist/node/main.js"],
  "engines": { "node": ">=26", "bun": ">=1.4" },
  "workspaces": [
    "src/packages/shared",
    "src/packages/core",
    "src/packages/config-tui",
    "src/packages/gateway",
    "src/packages/tui",
    "src/packages/tui-kit"
  ],
  "scripts": {
    "dev": "bun run src/main.ts --sandbox ./sandbox ...",
    "test": "bun test",
    "check:size": "bun run scripts/check-code-size.ts",
    "typecheck": "bun run --workspaces typecheck",
    "typecheck:node": "tsc -p tsconfig.node.json",
    "build": "bun run --workspaces build",
    "build:bin": "bun build ./src/main.ts --compile --outfile dist/atom --target bun",
    "build:node": "bun build ./src/main.ts --target node --outdir ./dist/node --external '@opentui/*' --banner '#!/usr/bin/env node'",
    "smoke:node": "bun run scripts/node-smoke/run-all.ts",
    "smoke:node:platform": "bun run scripts/node-smoke/run-all.ts platform",
    "smoke:node:release": "bun run scripts/node-smoke/run-all.ts release",
    "smoke:node:package": "bun run scripts/node-smoke/package.ts",
    "prepack": "bun run build:node",
    "docs": "bun run docs/server.ts",
    "docs:check": "bun run scripts/check-docs.ts",
    "docs:typecheck": "tsc -p tsconfig.docs.json"
  },
  "dependencies": {
    "@opentui/core": "0.8.4",
    "@opentui/react": "0.8.4",
    "react": "^19.2.8",
    "ws": "^8.22.2"
  },
  "devDependencies": {
    "@atom-neo/*": "workspace:*",
    "ai": "^7.0.169"
  }
}
```

The published tarball contains only `package.json` and `dist/node/main.js`.
All `@atom-neo/*` workspace packages are build-time `devDependencies`; the Node
bundle inlines them. Runtime dependencies stay limited to external `@opentui/*`
packages (plus `react` and `ws`, which `@opentui/react` peers on). Source,
tests, docs and scripts are excluded through `files`; npm always includes
`package.json`. Tarball install/run instructions are in
[development-setup.md](./development-setup.md#74-node-package-layout-and-tarball-install-s10-b2).

### TypeScript configurations

| Config | Runtime types | Scope |
|---|---|---|
| `tsconfig.json` | none (shared base) | Base compiler options inherited by all configs |
| `tsconfig.node.json` | `["node"]` | Production `src/**/*.ts(x)`; excludes tests, `dist`, and the Bun HTTP adapter |
| `tsconfig.docs.json` | `["bun"]` | `docs/**/*.ts` + `scripts/check-docs.ts` |
| `src/packages/*/tsconfig.json` | `["bun"]` | Per-workspace Bun typecheck/build |

### Path aliases

- `@assets/*` → `src/assets/*`: app-level bundled assets (for example prompt Markdown).
- `@core/*` → `src/packages/core/src/*`: cross-layer imports **inside core only**.
  Example: `import type { ContextService } from "@core/context/context-service"`.
- Keep `./` / `../` for same-module imports; use `@atom-neo/shared` for shared
  types and `@atom-neo/<package>` across workspace package boundaries.
- `@core/*` is resolved by TypeScript, Bun, and the Bun/Node build; the published
  Node artifact is bundled, so no runtime alias resolver is required.

`tsconfig.node.json` deliberately does not weaken `types`. Bun-only production
code is isolated by path instead: `bun-http-server.ts` resolves to the type-only
`bun-http-server.node.ts` through `moduleSuffixes: [".node", ""]`, and the
OpenTUI runtime-plugin entry maps to `scripts/types/opentui-runtime-plugin-support.d.ts`.
This keeps both the Bun adapter and `@types/bun` out of the Node program.
Runtime detection uses `hasBunRuntime()` from `@atom-neo/shared` instead of
referencing the `Bun` global directly.

## 9. Package Dependencies

```text
shared/
  Dependencies: zod, string-width, ws (Node adapter, dynamically imported)
  Dev dependencies: @types/ws
  Depended on by: core, gateway, config-tui, tui, tui-kit

core/
  Dependencies: shared, ai, @ai-sdk/deepseek, @ai-sdk/openai, @ai-sdk/anthropic,
                @ai-sdk/openai-compatible, @ai-sdk/mcp, @toon-format/toon, croner, zod
  Depended on by: (none, loaded by main.ts)

config-tui/
  Dependencies: shared, tui-kit, @opentui/core, @opentui/react, react
  Depended on by: (none, launched as subprocess/early-exit by main.ts)

gateway/
  Dependencies: shared, zod
  Depended on by: (none, standalone service)

tui/
  Dependencies: shared, tui-kit, react, zustand, @opentui/core, @opentui/react
  Depended on by: (none, standalone application)

tui-kit/
  Dependencies: shared, react, @opentui/core, @opentui/react
  Depended on by: config-tui, tui
```

### Node smoke scripts

```text
scripts/node-smoke/
├── http-runtime.ts        # node:http + ws adapter contract smoke (S9-C)
├── core-runtime.ts        # Core on Node: health/attach/WS/stop (S9-D)
├── core-conversation.ts   # Node fake model -> conversation task completed (S9-E)
├── cross-runtime.ts       # Bun client -> Node Core entry bundle (S9-E)
├── build.ts               # S10-A: dist/node artifact + --help + bun-import + TUI import smoke
├── tui-render.ts          # Node TUI render smoke via OpenTUI test renderer
├── platform.ts            # S10-B1: config/env + memory FTS5 + shell + glob + schedule
├── release.ts             # S10-B1: built dist/node/main.js health/attach/WS/SIGTERM
├── package.ts             # S10-B2: pack/install tarball + installed --help/bin/Core smoke
└── run-all.ts             # S10-B1: smoke:node orchestrator
```

The S9 Node scripts (`http-runtime.ts`, `core-runtime.ts`, `core-conversation.ts`) are bundled with `bun build --target node --external ws` and run under Node; `cross-runtime.ts` runs under Bun and builds the Node entry itself. `build.ts` runs under Bun, executes its checks under Node, and requires `bun run build:node` first. `platform.ts` is bundled for Node and uses only temp sandboxes. `release.ts` runs under Bun but starts the built `dist/node/main.js` artifact under Node; it never builds the artifact itself. `tui-render.ts` runs under Node and uses the OpenTUI test renderer to verify a real bordered character frame. `package.ts` is the S10-B2 tarball install smoke: build, `npm pack`, inspect, `npm install` into a temp project, installed `--help`/bin, and a real Core health/SIGTERM cycle. `run-all.ts` wires `smoke:node` (build check + platform + TUI render + release + conversation), `smoke:node:platform` and `smoke:node:release`. Commands are documented in [development-setup.md](./development-setup.md#71-node-runtime-smoke-optional), [development-setup.md](./development-setup.md#72-node-build-and-tui-import-guard-s10-a), [development-setup.md](./development-setup.md#73-node-platform-and-release-artifact-smoke-s10-b1) and [development-setup.md](./development-setup.md#74-node-package-layout-and-tarball-install-s10-b2).

### Node build output

```text
dist/                           # gitignored
├── atom                        # Bun compiled binary (`bun run build:bin`)
└── node/
    └── main.js                 # Node bundle (`bun run build:node`), shebang + bin.atom
```

`build:node` keeps `@opentui/*` external, bundles `ws`, prepends
`#!/usr/bin/env node`, and is rebuilt by `prepack` before `npm pack`.
`build:bin` remains the Bun single-file compile path and is unchanged.

## 10. Runtime Directories

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
