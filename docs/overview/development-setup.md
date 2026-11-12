# Development Environment Setup

> **Purpose**: Step-by-step guide to set up the development environment from scratch.
> Everything needed to go from `git clone` to a running dev server.

---

## 1. Prerequisites

```bash
# Required:
bun >= 1.4.0        # JavaScript runtime + package manager
git                  # Version control

# Required for Node typecheck/build/runtime smoke:
node >= 26           # Node target for `typecheck:node` / `build:node`

# Optional:
direnv               # Auto-load .env files
```

---

## 2. Clone and Install

```bash
git clone <repo-url> atom_neo
cd atom_neo
bun install           # Installs all workspace dependencies
```

---

## 3. Environment Variables

```bash
# Copy and edit the example:
cp .env.example .env

# Edit .env:
# nano .env  # or vim, code, etc.

# Required:
DEEPSEEK_API_KEY=sk-your-key-here

# Optional (defaults are fine for dev):
CORE_PORT=3100
GATEWAY_PORT=3000
MEMORY_DB_PATH=./data/memory.db
REPLAY_ENABLED=true    # Enable pipeline replay for debugging
```

---

## 4. Verify Setup

```bash
# Type check all packages (Bun workspace typecheck)
bun run typecheck

# Node production-source typecheck (tsconfig.node.json, types: ["node"])
bun run typecheck:node

# Node platform + release artifact smokes (Node >= 26)
bun run smoke:node

# Pack the root package, install the tarball in a temp project and run it (Node >= 26)
bun run smoke:node:package

# Run all tests
bun test

# Expected output:
#   X pass
#   0 fail
```

`typecheck:node` checks production sources only: tests (`*.test.ts` / `*.test.tsx`),
`dist`, and the Bun-only HTTP adapter (`src/packages/shared/src/http/bun-http-server.ts`)
are excluded. It also covers app-level sources (`src/main.ts`, `src/bootstrap`,
`src/services`) that the workspace-only `typecheck` does not compile. Workspace
typechecks keep `types: ["bun"]` and are unchanged.
The Node config uses `moduleSuffixes: [".node", ""]` so the Bun HTTP adapter
resolves to the type-only `bun-http-server.node.ts`, and maps OpenTUI's Bun-only
runtime plugin to an exact shim under `scripts/types/`. This keeps `@types/bun`
out of the Node program (verified with `tsc --listFiles`).

---

## 5. Start Development

```bash
# Terminal 1: Start Core
bun run --filter @atom-neo/core dev

# Terminal 2: Start Gateway (optional, for platform client testing)
bun run --filter @atom-neo/gateway dev

# Terminal 3: Start TUI (optional, for terminal testing)
bun run --filter @atom-neo/tui dev

# Or start everything at once:
bun run dev:all
```

---

## 6. Verify Running

```bash
# Core health check
curl http://localhost:3100/api/health

# Expected response:
# {"status":"ok","uptime":12,"queue":{"waiting":0,"processing":0},"sessions":0}

# Submit a test task
curl -X POST http://localhost:3100/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session",
    "chatId": "test-chat",
    "pipeline": "conversation",
    "source": "external",
    "data": { "text": "Hello, world!" }
  }'

# Expected: {"taskId":"...","state":"waiting"}
```

---

## 7. WebSocket Test

```bash
# Connect to Core WebSocket
wscat -c ws://localhost:3100/ws/test-session

# Send a task:
{"type":"task.submit","seq":0,"ts":1700000000,"payload":{"sessionId":"test-session","chatId":"test-chat","pipeline":"conversation","source":"external","data":{"text":"Hello"}}}

# Expected streaming events:
# {"type":"event.task.created","seq":1,"ts":...,"payload":{"taskId":"...","state":"pending"}}
# {"type":"event.pipeline.element.started","seq":2,"ts":...,"payload":{"elementName":"CollectPrompts",...}}
# {"type":"event.transport.delta","seq":3,"ts":...,"payload":{"taskId":"...","textDelta":"Hello"}}
# {"type":"event.task.completed","seq":...,"ts":...,"payload":{"taskId":"...","result":{...}}}
```

---

### 7.1 Node runtime smoke (optional)

Node >= 26 can run the same Core/Gateway transport through the `node:http` + `ws`
adapter. The scripts bundle for Node and keep `ws` external; each command prints
`PASS ...` lines and exits non-zero on failure.

```bash
# 1) Adapter contract: health, POST body, admin IP, WS ready/ping, two-stage stop
mkdir -p /tmp/atom-node-http-smoke/node_modules
ln -sfn "$PWD/src/packages/shared/node_modules/ws" /tmp/atom-node-http-smoke/node_modules/ws
bun build scripts/node-smoke/http-runtime.ts --target node --external ws \
  --outfile /tmp/atom-node-http-smoke/http-runtime.mjs
node /tmp/atom-node-http-smoke/http-runtime.mjs

# 2) Core on Node: health, TUI attach, WS session.ready/ping-pong, clean stop
mkdir -p /tmp/atom-node-core-smoke/node_modules
ln -sfn "$PWD/src/packages/shared/node_modules/ws" /tmp/atom-node-core-smoke/node_modules/ws
bun build scripts/node-smoke/core-runtime.ts --target node --external ws \
  --outfile /tmp/atom-node-core-smoke/core-runtime.mjs
node /tmp/atom-node-core-smoke/core-runtime.mjs

# 3) Fake conversation on Node: local fake model -> task completed -> assistant message
mkdir -p /tmp/atom-node-conversation-smoke/node_modules
ln -sfn "$PWD/src/packages/shared/node_modules/ws" /tmp/atom-node-conversation-smoke/node_modules/ws
bun build scripts/node-smoke/core-conversation.ts --target node --external ws \
  --outfile /tmp/atom-node-conversation-smoke/core-conversation.mjs
node /tmp/atom-node-conversation-smoke/core-conversation.mjs

# 4) Bun client -> Node Core entry bundle (cross-runtime attach + session.ready)
bun scripts/node-smoke/cross-runtime.ts
```

The fake conversation smoke does not call any external provider: it starts a local
OpenAI-compatible server that streams `<<<COMPLETE>>>`, so the conversation task
must finish as `completed` and persist the assistant reply.

---

### 7.2 Node build and TUI import guard (S10-A)

S10-A adds a Node-targeted build while keeping the Bun compile path unchanged.

```bash
# Build Node output: dist/node/main.js (dist/ is gitignored)
bun run build:node

# Run the Node entry from the repository root
node dist/node/main.js --help

# Node build smoke: output exists, --help exits 0, no static bun imports,
# and the TUI entry imports under Node without loading the Bun-only plugin
bun run scripts/node-smoke/build.ts
```

Build details:

- `build:node` runs `bun build src/main.ts --target node --outdir dist/node --external '@opentui/*' --banner '#!/usr/bin/env node'`.
- The banner makes `dist/node/main.js` directly executable and is required by the
  `atom` npm `bin` entry.
- `@opentui/*` stays external so Bun-only OpenTUI runtime code is not inlined.
- `ws` is bundled, so `dist/node/main.js` resolves its WebSocket dependency from
  the bundle instead of requiring a root-level `ws` install.
- `build:bin` (`bun build --compile --target bun`) is unchanged.
- The Bun HTTP adapter is skipped in the Node program via
  `moduleSuffixes: [".node", ""]` -> `bun-http-server.node.ts`; Bun builds/tests
  still resolve the real `bun-http-server.ts`.
- `@opentui/react/runtime-plugin-support` throws in its Node export. The TUI
  entrypoints (`@atom-neo/tui`, `@atom-neo/config-tui`) now call
  `ensureBunRuntimePluginSupport()` from `@atom-neo/tui-kit` right before
  creating the renderer: Bun registers the plugin, Node skips the import
  entirely. Importing the TUI modules under Node therefore no longer throws.

S10-B1 adds the platform and release artifact smokes in section 7.3. S10-B2 adds
the npm package layout, tarball install smoke (section 7.4) and the two-job CI
workflow (section 12).

---

### 7.3 Node platform and release artifact smoke (S10-B1)

`smoke:node` rebuilds `dist/node/main.js`, runs the S10-A build check, then runs
the platform and release artifact smokes under actual Node >= 26. It finishes
with the existing fake conversation smoke.

```bash
# Full sequence: build:node + build check + platform + release + conversation
bun run smoke:node

# Individual subsets
bun run smoke:node:platform   # platform bundle only; does not need dist/node
bun run smoke:node:release    # rebuilds dist/node, then checks the artifact
```

Platform coverage (`scripts/node-smoke/platform.ts`, bundled with
`bun build --target node`):

- **config**: writes `config.json`, `.env` and `.atom/runtime-config.json` into a
  temp sandbox, calls the real `loadEnv`/`loadConfig` path, and asserts env
  loading, default config creation, user/runtime overlay merge, effective
  provider protocol/models and profile values.
- **memory FTS5**: real `MemoryService` on `node:sqlite`, saves two nodes,
  searches through FTS5 with hit and non-hit assertions, and verifies the
  database handle is closed after `stop()`.
- **shell**: real `BackgroundShellService` (`node:child_process`) runs `printf`,
  asserts exit code 0 and stdout, then stops the service.
- **glob**: real glob tool (`node:fs/promises` glob) matches files in a temp
  sandbox and respects the tool's `path` scope.
- **schedule**: real `ScheduleService` creates delay and cron tasks, asserts
  list/persist/restore behavior, then stops both instances.

Release coverage (`scripts/node-smoke/release.ts`):

- Uses the built `dist/node/main.js`, never a source bundle.
- Creates a temp sandbox with `config.json`, `.env`, `AGENTS.md` and
  `.atom/installed`, then starts
  `node dist/node/main.js --mode core --port 0 --host 127.0.0.1 --sandbox <temp>`
  with `ATOM_HTTP_RUNTIME=node`.
- Asserts `.atom/core-runtime.json`, `/api/health` 200, `/api/tui/attach` 200
  with a session id and real `serverInfo.port`, WebSocket `session.ready` plus
  `ping` → `pong`, SIGTERM exit code 0, runtime-file cleanup and temp cleanup.
- Fails clearly when `dist/node/main.js` is missing; run `bun run build:node` or
  `bun run smoke:node:release` first. The smoke itself never builds the artifact.

The platform smoke has a 45 s watchdog and the release smoke a 60 s watchdog.
Both print `PASS ...` lines and exit non-zero on the first failure.

---

### 7.4 Node package layout and tarball install (S10-B2)

The root package is publishable as an npm tarball. `prepack` rebuilds
`dist/node`, and `files` ships only the Node bundle plus `package.json`.

```bash
# From the repository root; prepack runs `bun run build:node`
npm pack
# -> atom-neo-1.24.0.tgz
#    ~0.56 MiB packed / ~2.87 MiB unpacked
#    package/package.json + package/dist/node/main.js only

# Install into a throwaway project
mkdir /tmp/atom-neo-install && cd /tmp/atom-neo-install
npm init -y
npm install /path/to/atom-neo-1.24.0.tgz

# Entrypoint and bin
node node_modules/atom-neo/dist/node/main.js --help
npx --no-install atom --help

# Core under Node (Node >= 26)
ATOM_HTTP_RUNTIME=node \
  node node_modules/atom-neo/dist/node/main.js --mode core --port 3100 --sandbox ./sandbox
```

Package layout:

- `main` / `exports["."].bun` / `exports["."].node` / `exports["."].default` -> `./dist/node/main.js`.
- The published tarball ships only `dist/node`; Bun workspace development still runs
  `bun run src/main.ts`, but package imports resolve to the built artifact.
- `bin.atom` -> `./dist/node/main.js`; `build:node` prepends
  `#!/usr/bin/env node`, and npm links the bin on install.
- `files` -> `["dist/node/main.js"]`, so source, tests, docs and scripts do not
  ship. `package.json` is always included by npm.
- `@atom-neo/*` workspace packages are build-time only and live in
  `devDependencies`. The Node bundle inlines them, so the tarball's runtime
  dependencies are only `@opentui/core`, `@opentui/react`, `react` and `ws`.
- `@opentui/*` stays external and is installed from the registry. The TUI needs
  those packages at runtime; Core/HTTP mode does not import the TUI entrypoints.
- Node **26 only** (`engines.node >= 26`). The Bun source path and
  `build:bin --compile` binary are unchanged.

`bun run smoke:node:package` validates this end to end: build, `npm pack`,
tarball contents, runtime dependency rewrite, installation into a temp project,
`--help`, `npx --no-install atom --help`, and a real installed Core
health/SIGTERM cycle. The TUI entrypoint import is covered by
`scripts/node-smoke/build.ts`; an automated TUI render test under Node remains a
follow-up.

---

## 8. Directory Structure After Setup

```text
atom_neo/
├── .env                  # Your local environment (gitignored)
├── .env.example          # Template for new developers
├── .gitignore
├── package.json          # Workspace root
├── bun.lock              # Lockfile
├── data/
│   └── memory.db         # SQLite database (auto-created, gitignored)
├── packages/
│   ├── shared/
│   ├── core/
│   ├── gateway/
│   └── tui/
├── docs/
│   └── ... (all docs)
└── node_modules/
```

---

## 9. Common Issues

```bash
# "bun: command not found"
# Solution: Install Bun: curl -fsSL https://bun.sh/install | bash

# "Cannot find module '@atom-neo/shared'"
# Solution: Run `bun install` from the workspace root

# "Port 3100 already in use"
# Solution: Change CORE_PORT in .env or kill the process:
#   lsof -ti:3100 | xargs kill -9

# "DEEPSEEK_API_KEY not set"
# Solution: Set in .env or export DEEPSEEK_API_KEY=sk-xxx

# Tests fail with "Database is locked"
# Solution: rm -f data/memory.db && bun test

# TypeScript errors about missing types
# Solution: bun run typecheck (shows exact errors)
```

---

## 10. Development Workflow

```bash
# 1. Create a new branch
git checkout -b feature/my-feature

# 2. Make changes
# Edit code, follow docs/

# 3. Type check
bun run typecheck

# 4. Run tests
bun test                          # All tests
bun test src/packages/core            # Core only
bun test --watch                  # Watch mode

# 5. Commit
git add -A
git commit -m "feat(core): description"

# 6. Push
git push origin feature/my-feature
```

---

## 11. IDE Setup (VS Code)

```json
// .vscode/settings.json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.preferences.importModuleSpecifier": "non-relative",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.organizeImports": "explicit"
  }
}
```

```json
// .vscode/extensions.json
{
  "recommendations": [
    "bun.bun-vscode"
  ]
}
```

---

## 12. CI Setup (GitHub Actions)

`.github/workflows/ci.yml` runs two jobs on every push and pull request. YAML
syntax is validated locally with `ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml")'`.

**Bun job** (`ubuntu-latest`):

1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2` with Bun `1.4.2`
3. `actions/cache@v4` for `~/.bun/install/cache`, keyed by `bun.lock`
4. `bun install --frozen-lockfile`
5. `bun run typecheck`
6. `bun test`
7. `bun run build`
8. `bun run docs:check`
9. `bun run docs:typecheck`

**Node 26 job** (`ubuntu-latest`):

1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2` with Bun `1.4.2` (build/smoke orchestration)
3. `actions/setup-node@v4` with Node `26` (runtime under test)
4. Bun install cache + `bun install --frozen-lockfile`
5. `bun run typecheck:node`
6. `bun run build:node`
7. `node scripts/node-smoke/build.ts`
8. `bun run smoke:node`
9. `bun run smoke:node:package`

The Node job intentionally uses Bun to build/bundle the smoke scripts while the
runtime checks execute with the real Node 26 binary.

---

## 13. Dependency Upgrade Baseline

- Workspace 共享依赖必须在根目录和各 package 中保持一致，OpenTUI 的
  `@opentui/core`、`@opentui/react` 与根目录 `overrides` 必须使用同一精确版本。
- 当前 OpenTUI 基线为 `0.5.8`，运行时要求 `bun >= 1.4.0`。
- `opentui-spinner` 仅兼容 OpenTUI `0.3.x` 与 TypeScript `5.x`，不再使用；加载状态复用
  `@atom-neo/tui` 自有的 `BounceBarSpinner`。
- TypeScript `7.x` 不再支持 `baseUrl`；路径别名直接通过 `paths` 解析。
- `@types/bun` 跟随实际验证的 Bun runtime；当前保持 `1.3.14`，不提前使用 `1.4.x` API 类型。
- Node 类型检查使用根目录 `@types/node`（当前锁定 `26.6.6`）；`tsconfig.node.json`
  仅包含生产源码，不引入 `@types/bun`，因此源码中的运行时判断不能再直接引用 `Bun` 全局
  （统一使用 `hasBunRuntime()`）。
- 升级顺序固定为：更新文档 → 修改 manifest → `bun install` → `bun run typecheck`
  → `bun run typecheck:node` → `bun test` → `bun run build` → `bun run build:node`。
- `bun outdated --recursive` 用于复核所有 workspace；仍需保留旧主版本的依赖必须在
  升级结果中明确记录原因。

## 相关文档

| 文档 | 说明 |
|------|------|
| [bootstrap.md](./bootstrap.md) | 启动流程 |
| [project-structure.md](./project-structure.md) | 目录结构 |
| [testing.md](../standards/testing.md) | 测试命令和规范 |
