# Development Environment Setup

> **Purpose**: Step-by-step guide to set up the development environment from scratch.
> Everything needed to go from `git clone` to a running dev server.

---

## 1. Prerequisites

```bash
# Required:
bun >= 1.3.0        # JavaScript runtime + package manager
git                  # Version control

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
# Type check all packages
bun run typecheck

# Run all tests
bun test

# Expected output:
#   X pass
#   0 fail
```

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

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run typecheck
      - run: bun test
```

---

## 13. Dependency Upgrade Baseline

- Workspace 共享依赖必须在根目录和各 package 中保持一致，OpenTUI 的
  `@opentui/core`、`@opentui/react` 与根目录 `overrides` 必须使用同一精确版本。
- 当前 OpenTUI 基线为 `0.5.8`，运行时要求 `bun >= 1.3.0`。
- `opentui-spinner` 仅兼容 OpenTUI `0.3.x` 与 TypeScript `5.x`，不再使用；加载状态复用
  `@atom-neo/tui` 自有的 `BounceBarSpinner`。
- TypeScript `7.x` 不再支持 `baseUrl`；路径别名直接通过 `paths` 解析。
- `@types/bun` 跟随实际验证的 Bun runtime；当前保持 `1.3.14`，不提前使用 `1.4.x` API 类型。
- 升级顺序固定为：更新文档 → 修改 manifest → `bun install` → `bun run typecheck`
  → `bun test` → `bun run build`。
- `bun outdated --recursive` 用于复核所有 workspace；仍需保留旧主版本的依赖必须在
  升级结果中明确记录原因。

## 相关文档

| 文档 | 说明 |
|------|------|
| [bootstrap.md](./bootstrap.md) | 启动流程 |
| [project-structure.md](./project-structure.md) | 目录结构 |
| [testing.md](../standards/testing.md) | 测试命令和规范 |
