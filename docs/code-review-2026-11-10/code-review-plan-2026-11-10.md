# Atom Neo Code Review Plan — 2026-11-10

> 配套文件：
> - [code-review-2026-11-10.md](./code-review-2026-11-10.md)
> - [code-review-graph-2026-11-10.md](./code-review-graph-2026-11-10.md)
>
> **Branch**: `code-review/2026-11-10`
> **Baseline**: `main` @ `e9b9452` (v1.22.0)
> **状态**: S0–S11 已完成；S11（全局状态 / DI 收口）已于 2026-11-12 完成并发布 v1.23.0。S12（巨型文件 / TUI 结构重构）已于 2026-11-12 完成拆分，待实施。

---

## 0. 决策记录

| 决策 | 结论 | 影响 |
|---|---|---|
| Node.js 支持 | **正式支持目标** | 需要运行时标准化、Node HTTP/WS、构建/CI |
| Node 支持下限 | **Node >= 26** | Node 24 不再支持；入口统一使用 `import.meta.main` |
| Web 文档 | **不保留现有 Web 页面**；需要 HTTP server 把 Markdown 渲染成 HTML | 删除旧 JSX 文档站 + React SSR，新增 `node:http` 渲染服务 |
| 未实现 Element | **暂时不动** | 5 个兼容 Element、follow-up、Replay、PipelineRunner/Manager 保持原样 |
| 多 Provider | **需要** | 新增 Provider 工厂、配置 protocol、Prompt 语言、Provider options |
| S9 运行时形态 | **双 adapter**；默认 Bun，`ATOM_HTTP_RUNTIME=node` 可选 | `ws` on Bun spike 通过，但 S9 不统一/不删除 Bun adapter，至少保留一个版本（1.22.10）作为回滚；S10 再评估 |
| Node 发布包 | **tarball 仅含 `dist/node/main.js` + `package.json`**；`@atom-neo/*` 为 `devDependencies`；运行时依赖仅 external `@opentui/*` + `react`/`ws` | npm 安装不再解析未发布的 workspace 包；CI 用 `smoke:node:package` 验证真实安装 |

### 版本基线

- Node：**>= 26**；CI 覆盖 Node 26（Node 24 不再支持）。
- Bun：建议 **>= 1.4**（`node:sqlite` / `fs.glob` / `child_process` 已在本机 1.4.2 验证）。
- 本机已验证：
  - Node 26：`node:sqlite` + FTS5、`fs.glob`、`import.meta.main`、`@opentui/core` Node 导出可用。
  - Bun 1.4.2：`node:sqlite` + FTS5、`fs.glob`、`node:child_process` 可用。

---

## 1. 总体原则

1. **Node 标准 API 作为共同基线**：不为 `node:fs/path/crypto` 造抽象。
2. **只对真正分歧点做端口**：HTTP/WebSocket；其余能力优先统一实现。
3. **先修正确性，再谈结构**：P0 独立修复，避免重构掩盖 bug。
4. **先加测试，再迁移**：每个阶段先写/补测试，再改调用点。
5. **一个阶段一个 PR**：保持可回滚；大阶段拆子 PR。
6. **禁区不动**：未实现 Element、follow-up、Replay、PipelineRunner/Manager 本次不改。
7. **不做大爆炸**：不重写全部测试，不引入 DI 容器，不做全量插件化。

---

## 2. 阶段总览

| 阶段 | 主题 | 风险 | 预估 | 依赖 | 主要 CR |
|---|---|---|---|---|---|
| S0 | 基线与可行性验证 | 极轻 | 0.5–1 天 | — | — |
| S1 | P0 正确性修复 | 轻 | 1–2 天 | S0 | CR-COR-01..11 |
| S2 | 运行时标准化（非 Server） | 中 | 4–6 天 | S1 | CR-RUN-01..05, CR-DUP-04/05/06 |
| S3 | 共享配置与基础工具 | 轻–中 | 3–5 天 | S1 | CR-DUP-03..07, CR-NAM-01/09 |
| S4 | 文档 Markdown → HTML 服务 | 中 | 2–3 天 | S1 | CR-DUP-09, CR-DOC-01..10 |
| S5 | TUI 共享组件包 | 中 | 4–6 天 | S1/S3 | CR-DUP-01/02, CR-ARCH-05 |
| S6 | 事件与任务提交统一 | 中 | 3–4 天 | S1 | CR-DUP-08, CR-COR-10, CR-ARCH-15 |
| S7 | 多 Provider 抽象 | 中–高 | 4–6 天 | S3 | CR-PRO-01..06 |
| S8 | 拆分 `server.ts` | 高 | 4–6 天 | S6/S7 | CR-ARCH-13, CR-STR-02 |
| S9 | HTTP/WS 运行时统一 + Node 入口 | 极高 | 6–9 天 | S2/S8 | CR-RUN-06, CR-ARCH-04 |
| S10 | Node 构建/测试/发布 | 高 | 4–6 天 | S9 | CR-RUN-07 |
| S11 | 全局状态/DI 收口 | 极高 | 5–8 天 | S3/S10 | CR-ARCH-01..09 |
| S12 | 巨型文件与 TUI 结构重构 | 极高 | 8–12 天 | S7/S11 | CR-STR-01..11, CR-DUP-11/12 |

### 顺序原则

- **S1 → S2 → S9 → S10**：Node 支持主路径。
- **S1 → S3 → S7 → S8 → S9**：Provider + Server 拆分耦合路径。
- **S4 / S5 可并行**：文档与 TUI kit 不阻塞主路径。
- **S11 → S12**：先收口构造/全局状态，再拆文件，避免拆完又改构造。
- **S6 → S8**：事件契约稳定后再拆 server。

---

## 3. 阶段详情

### S0 — 基线与可行性验证（极轻）

**目标**：锁定基线，验证 Node/Bun 关键能力，避免后期返工。

**任务清单**：

- [ ] 记录 `bun run typecheck`、`bun test`、`bun run build` 基线（通过数/失败数/耗时）。
- [ ] 添加 `engines`：`node >= 26`、`bun >= 1.4`。
- [ ] 验证 `node:http + ws` 在 Bun 下可用性：
  - 可用 → S9 采用统一实现（方案 A）。
  - 不可用 → S9 采用 Bun/Node 双实现端口（方案 B）。
- [ ] 验证 `@opentui/react`/`@opentui/core` 在 Node 下的启动/渲染（本机已可加载，固化为 smoke）。
- [ ] 确认 `node:sqlite` 在最低 Node/Bun 版本的 FTS5、WAL、参数绑定行为。
- [ ] 创建 `scripts/node-smoke/` 骨架（config/memory/shell/glob/schedule）。

**验收**：
- 基线记录写入 PR 描述。
- S0 决策记录（方案 A/B、最低版本）追加到本文件。

**风险/回滚**：无源码改动，无风险。

---

### S1 — P0 正确性修复（轻）

**目标**：消除数据丢失、生命周期错误、平台 bug。

**任务清单**：

- [ ] `CR-COR-01`：`config-tui` `commit()` 改 async/同步写；`tui` 未知字段保留。
- [ ] `CR-COR-02`：Task.Completed 保存失败回滚消息 + tokenUsage + 预算。
- [ ] `CR-COR-03`：MemoryService 构造器只存配置；`start()` 开库/迁移；`stop()` 关闭；修 `retain()` weight。
- [ ] `CR-COR-04`：ServiceManager fail-fast + 已启动服务回滚；BaseService running 状态修正。
- [ ] `CR-COR-05`：PipeSink 使用 `fs.constants.O_NONBLOCK`。
- [ ] `CR-COR-06`：MCP init 增加 stopping 守卫；ref 声明前置。
- [ ] `CR-COR-07`：删除 `registerSharedElements` 静默 catch。
- [ ] `CR-COR-08`：trigram 百分比乘 100。
- [ ] `CR-COR-09`：TaskQueue 完成状态上限；ToolRecord suspend 释放/裁剪。
- [ ] `CR-COR-10`：WS `task.submit` 使用 `payload.pipeline`；与 HTTP 共用提交逻辑（最小版）。
- [ ] `CR-COR-11`：`BootArguments.wizard` 入类型；`main.ts` 不再读原始 argv。

**验收**：
- 每项有回归测试（失败注入/并发/往返）。
- `bun test` 全量通过。
- `bun run typecheck` 通过。

**风险/回滚**：低；按文件拆 commit，可单独 revert。

---

### S2 — 运行时标准化（非 Server）（中）

**目标**：去掉所有非 Server 的 Bun 专有 API，统一到 Node 标准 API。

#### S2a 轻量替换（1–2 天）

- [x] `CR-RUN-01`：`Bun.write` → `writeFileSync` / `fs.promises.writeFile`。
- [x] `CR-RUN-02`：`Bun.env` → `process.env`。
- [x] `CR-RUN-03`：`Bun.argv` → `process.argv`。
- [x] `CR-RUN-04`：`Bun.sleep` → shared `sleep`；`Bun.stringWidth` → `string-width`。
- [x] `Bun.main` → `import.meta.main` / `process.argv[1]`。

#### S2b 进程/文件/定时（2–3 天）

- [x] `CR-RUN-02`：`Bun.spawn`/`Bun.Subprocess` → `node:child_process` + `ProcessHandle`。
- [x] `CR-RUN-03`：`Bun.Glob` → `fs.glob` / `fs.globSync`。
- [x] `CR-RUN-04`：`Bun.cron` → `croner`。
- [x] 涉及：`bootstrap/first-run.ts`、`gateway/client-manager`、`tools/builtin/shell.ts`、`builtin/fs.ts`、`tools/schedule-service.ts`。

#### S2c SQLite（3–4 天，单独 PR）

- [x] `CR-RUN-05`：`bun:sqlite` → `node:sqlite` 包装器。
- [x] 保留 `run/prepare/get/all/exec/close` 语义。
- [x] 验证 FTS5、WAL、事务、参数绑定。
- [x] 若最低 Bun < 1.4，保留临时 Bun/Node 分支并记录移除条件。

**实施记录（2026-11-10）**：

- 新增 `shared/src/utils/process.ts`：`spawnProcess` / `ProcessHandle`，统一 first-run、Gateway Client 与 Shell 的子进程语义。
- 新增 `shared/utils` 的 `stringWidth`（依赖 `string-width@8.3.0`）；`menu.ts` 不再使用 `Bun.stringWidth`。
- `bootstrap/cli.ts` 用 `process.argv[1]` / `process.versions.bun` 区分 Bun 源码、Bun 编译二进制与 Node；编译态帮助仍显示 `atom`。
- `fs.glob` 使用 `withFileTypes` 过滤目录，保留相对路径、cwd、500 上限与排序。
- `croner@11.0.0` 替换 `Bun.cron`；暂停实例用于解析 next run，`stop()` 保留服务停止语义。
- `services/sqlite-database.ts` 封装 `node:sqlite`（布尔/undefined 参数归一化、嵌套事务 savepoint、`changes` 数值化）；MemoryService 与测试改用包装器。

**验收**：
```bash
rg -n 'Bun\.' src --glob '!**/dist/**' --glob '!**/*.test.*'
# 仅剩 Bun.serve / Bun.Server 与 fixtures/gateway-client.ts（S9 处理）
```
- Node 下 config、memory、shell、glob、schedule smoke 通过。

**风险/回滚**：中；S2c 单独 PR，可回退到 `bun:sqlite`。

---

### S3 — 共享配置与基础工具（轻–中）

**目标**：消灭配置、env、原子写、helpers、领域类型的多份实现。

**任务清单**：

- [x] `CR-DUP-03`：`shared/src/config/` 作为唯一配置契约：
  - `ConfigSchema`、默认值、`RuntimeConfigSchema`、`mergeConfig`。
  - `PROVIDERS`、`DEFAULT_PROFILES`、主题名清单。
- [x] `CR-DUP-04`：`shared/src/utils/env-file.ts`：`parseEnv` / `upsertEnv` / `serializeEnv`。
- [x] `CR-DUP-05`：`shared/src/utils/fs.ts`：`writeFileAtomic`（persistence generation 延后 S12）。
- [x] `CR-DUP-06`：`shared/src/utils`：`createId`、`parsePort`、`clamp`、`sleep` 统一。
- [x] `CR-DUP-07`：Skill/MemoryKind/Todo 类型收口到 shared；`MemoryNode` 持久化行改名延后 S12。
- [x] `bootstrap/config.ts` 改为 re-export/薄封装。
- [x] `config-tui` 依赖 `@atom-neo/shared`，删除 `PROVIDERS`/`THEMES`/`DEFAULT_PROFILES`/env 解析。
- [x] `gateway/config.ts` 复用 ClientConfig schema。
- [x] 删除顶层 `theme` 死字段。
- [ ] `CR-NAM-01/09`：文件命名与文件头规范；新增检查脚本（延后 S3b）。

**验收**：
- 配置/向导/Gateway schema 测试。
- `.env` 的 `export KEY=`、CRLF、注释 round-trip。
- 原子写失败注入测试。
- 新增主题只改 1 处。

**风险/回滚**：轻–中；配置是核心，先加测试再迁移。

---

### S4 — 文档 Markdown → HTML 服务（中）

**目标**：删除 Web 双轨，只保留 Markdown + 极简 HTTP 渲染。

**任务清单**：

- [x] `CR-DUP-09`/`CR-DOC-01`：删除旧 JSX 文档站（pages/components/shared/server.tsx）。
- [x] 新建 `docs/server.ts`：
  - `node:http` + `marked` + `marked-highlight` + `highlight.js`。
  - `/` 渲染 `docs/index.md`；路径映射到 `.md`。
  - 相对链接重写；路径穿越防护；静态 CSS。
  - `--watch` 未实现；刷新页面即可看到 Markdown 更新。
- [x] `CR-DOC-02`：新建 `docs/records/`，移入验收/实验/计划记录。
- [x] `CR-DOC-03/04/05`：收敛 Context、启动、Skill 文档：
  - Context：`context-management.md`（所有权/生命周期）+ `context-outcome-governance.md`（Tool Result 契约）为当前文档；缓存方案与治理实施阶段归档到 records。
  - 启动：`bootstrap.md`（启动契约）+ `startup-menu.md`（菜单）为当前文档；实现记录、版本变更、计划与验收归档到 records。
  - Skill：`skill-system.md` 为当前文档；`skill-system-plan.md` 归档到 records。
- [x] `CR-DOC-06..08`：修正 architecture/configuration/protocol 的失真声明（本轮为定向修正）。
- [x] `CR-DOC-09/10`：修正失效 `src/` 路径、索引状态（本轮覆盖 `check-docs` 可验证范围）。
- [x] 新增 `scripts/check-docs.ts`：Markdown 链接 + 反引号 `src/` 路径。

**实施记录（2026-11-11）**：

- 文档服务统一为 `docs/server.ts`（marked 18 + marked-highlight 2 + highlight.js），删除 React SSR 站点；Bun 与 Node 26 启动同一路由。
- 新增 `docs/assets/docs.css`、`docs/server.test.ts`、`scripts/check-docs.ts`；`docs`/`docs:node`/`docs:check` 脚本更新。
- 历史验收/实验记录移入 `docs/records/`；`docs/index.md` 与全部相对链接同步。
- 根 `tsconfig.json` 保持原状；新增 `tsconfig.docs.json` 与 `docs:typecheck` 仅检查 docs/scripts，避免用根配置隐藏 `src/` 的既有类型问题；workspace 类型检查仍由各包负责。

**验收**：
- `bun run docs` 与 Node 启动同一服务，输出一致。
- 删除旧 JSX 文档站后无 React 文档依赖。
- `check-docs` 通过。

**风险/回滚**：中；纯文档，独立 PR，可 revert。

---

### S5 — TUI 共享组件包（中）

**目标**：消除 `tui` 与 `config-tui` 的 Modal/主题重复，解除主题循环依赖。

**任务清单**：

- [x] `CR-DUP-01/02`：新建 `@atom-neo/tui-kit` 工作区包：
  - 主题清单 + `ThemeProvider/useTheme/ThemeContext`。
  - `Modal`、`ModalActionBar`、`types`、`SelectableRow`、`FieldInput`（`ListModal` 未新增，Modal 列表模式已覆盖）。
- [x] `tui` 与 `config-tui` 改为依赖 `tui-kit`，删除副本。
- [x] `CR-ARCH-05`：ThemeContext 从 `tui/components/App.tsx` 移出。
- [x] 修 Modal 状态 bug：`selectedIndex` 重置、Tab/←/→ 互斥。
- [x] `config-tui` `commit()` 保留未知 `tui` 字段。
- [x] 给 `@atom-neo/tui` 补 `zustand` 依赖。
- [x] 统一 Modal 术语、SelectableRow 模板。

**验收**：
- 两包交互/快照测试。
- 新增主题只改 1 处。
- Modal 键盘行为测试。

**风险/回滚**：中；UI 回归风险，先接入 tui-kit 再删除旧文件。

---

### S6 — 事件与任务提交统一（中）

**目标**：一个事件目录、一个任务提交入口、一个协议类型来源。

**任务清单**：

- [x] `CR-DUP-08`：`shared/src/constants/events.ts` 作为唯一事件源。
- [x] `WsMessages`、`PipelineEventMap`、`ServerEvent/ClientEvent` 由常量派生。
- [x] 修复 `conversation.chain` / `conversation.idle` envelope，移除 `as any`。
- [x] `CR-COR-10`/`CR-ARCH-15`：新增 `TaskSubmissionService`：
  - HTTP/WS 共用。
  - WS 使用 `payload.pipeline`。
  - Zod 校验。
- [x] TUI `ws-client.ts` 改判别联合 + 路由表。
- [x] `CR-DOC-08`：同步修正 `protocol.md`。

**验收**：
- HTTP/WS 提交行为一致。
- WS 可选 pipeline 测试。
- 事件路径无 `as any`。
- 协议文档与实现对齐。

**风险/回滚**：中；事件路径广，但改动集中。

---

### S7 — 多 Provider 抽象（中–高）

**目标**：让 DeepSeek/OpenAI/Anthropic/OpenAI-compatible 真正可用。

**任务清单**：

- [x] `CR-PRO-02`：配置增加 `providers[id].protocol`，默认按 id 推断。
- [x] `CR-PRO-01`：新增 `createLanguageModel(resolved)` 工厂。
- [x] 替换 5 处 `createDeepSeek`。
- [x] `CR-PRO-04`：ProviderOptionsStrategy（deepseek/openai/anthropic）。
- [x] `CR-PRO-03`：所有 `resolvePrompt` 传 provider/model；非 DeepSeek 默认英文。
- [x] `CR-PRO-05`：AgentsCompiler 注入模型 resolver。
- [x] `CR-PRO-06`：移除跨 Provider API Key 回退。
- [x] 增加 `@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/openai-compatible` 依赖。

**验收**：
- 四种 provider 配置均能构造模型（fake）。
- 提示词语言/Provider options 单测。
- `rg 'createDeepSeek'` 只剩工厂内一处。
- 可选 live smoke（不计入 CI）。

**风险/回滚**：中–高；LLM 行为变化，必须用 fake 测试覆盖。

---

### S8 — 拆分 `server.ts`（高）

**目标**：在接入 Node HTTP 前，把 `startCore` 拆成可测试模块，行为不变。

**任务清单**：

- [x] `CR-ARCH-13`/`CR-STR-02`：拆为：
  - `bootstrap.ts`（构造）
  - `pipeline-factory.ts`（5 条 pipeline 的模型/Token/Context 解析）
  - `task-lifecycle.ts`（Completed/Failed/Committed、回滚）
  - `http-router.ts`（路由表 + `requireAdmin`）
  - `mcp-lifecycle.ts`（初始化/health/stop）
- [x] `startCore` 只保留组装与启停，目标 <200 行。
- [x] 保持 `Bun.serve` 不变（S9 再换）。

**验收**：
- 现有 server/continuation 测试行为不变。
- 新增路由表与 Task.Completed 回滚测试。
- `startCore` 行数目标达成。

**实施记录（2026-11-11）**：

- `server.ts` 由 853 行降至 102 行；新增 `bootstrap.ts`、`pipeline-factory.ts`、`task-lifecycle.ts`、`http-router.ts`、`mcp-lifecycle.ts`。
- `startCore` 仅保留 router 组装、`Bun.serve`、启动/停止顺序；`Bun.serve` 未迁移。
- 新增 `http-router.test.ts`（health/admin/任务提交/404）与 `task-lifecycle.test.ts`（checkpoint 回滚、chain/idle 调度）。
- typecheck/build 6/6，`docs:check`/`docs:typecheck` 通过；测试 1717 pass / 21 skip / 0 fail（源码 969）；版本 1.22.9。

**风险/回滚**：高；纯搬移 + 小修，按模块拆 commit。

---

### S9 — HTTP/WS 运行时统一 + Node 入口（极高）

**目标**：Core/Gateway 在 Node 下正式启动，并保留 Bun 支持。

> **S9 已拆分并单独成文**：
> - [code-review-s9-2026-11-11.md](./code-review-s9-2026-11-11.md) — 问题、当前/目标代码、契约
> - [code-review-s9-graph-2026-11-11.md](./code-review-s9-graph-2026-11-11.md) — 运行时关系、双实现、阶段依赖、风险热区
> - [code-review-s9-plan-2026-11-11.md](./code-review-s9-plan-2026-11-11.md) — S9-A..E 实施计划、测试、回滚、DoD

**子阶段**：

| 子阶段 | 主题 | 风险 | 依赖 |
|---|---|---|---|
| S9-A | 契约/类型 + `ws` on Bun spike | 低 | S8 |
| S9-B | Bun Adapter（行为不变） | 中 | S9-A |
| S9-C | Node Adapter（Node 可选） | 高 | S9-A/B |
| S9-D | Node 入口与运行时选择 | 中–高 | S9-C |
| S9-E | 双运行时验收与清理 | 中 | S9-A..D |

**验收**：
- Bun/Node 同一组 HTTP/WS 契约测试通过。
- Node 启动 Core、health、attach、一次 fake conversation；Gateway start/stop。
- 不设 `ATOM_HTTP_RUNTIME` 时 Bun 默认行为不变。
- HTTP 路由、状态码、WS 消息、admin token、Task/Event 契约不变。

**风险/回滚**：极高；每子阶段独立 commit；保留 Bun adapter 作为行为回滚点，Node 出问题不影响默认路径。

---

### S10 — Node 构建 / 测试 / 发布（高）

**目标**：Node 可安装、可验证、可发布。

**任务清单**：

- [x] `CR-RUN-07`：`tsconfig` 拆分：
  - 根 `tsconfig.json` 保持共享基础（不含 `types`）；新增 `tsconfig.node.json`。
  - 未单列 `tsconfig.bun.json`：workspace 配置继续 `types: ["bun"]`，行为不变。
- [x] Bun 二进制继续 `bun build --compile`。
- [x] Node 产物：`bun build --target node`，输出 `dist/node`；`@opentui/*` external。
- [x] `package.json`：`main`/`exports`/`bin`/`files` 指向 dist。
- [x] 确定 Node 包管理器（npm）对 `workspace:*` 的策略：工作区包移入 `devDependencies`，运行时依赖仅 external 包。
- [x] Node smoke suite：
  - config、memory FTS5、shell、glob、schedule。
  - Core 启动 + health + WS 一次对话。
  - TUI 入口 import。
  - tarball 打包/安装/运行 smoke。
- [x] CI 矩阵：Bun 全量；Node 26 typecheck + build + smoke + package。

**验收**：
- `node dist/node/main.js` 可启动。
- CI 双运行时绿。
- 发布包不含 `bun:` 导入。

**S10-A 实施记录（2026-11-11，仅构建/类型检查边界）**：

- [x] 根 `tsconfig.json` 保持共享基础配置（不含 `types`）；新增 `tsconfig.node.json`：
  `types: ["node"]`、`noEmit`，仅生产源码，排除 `*.test.ts(x)`、`dist` 与
  `shared/src/http/bun-http-server.ts`。Bun adapter 通过
  `moduleSuffixes: [".node", ""]` 在 Node 配置中解析为
  `bun-http-server.node.ts` 类型 shim；`@opentui/react/runtime-plugin-support`
  映射到 `scripts/types/` shim。`tsc --listFiles` 确认 Node program 不含
  `bun-types` 或真实 Bun adapter。
- [x] 新增 `typecheck:node`；workspace `typecheck`（`types: ["bun"]`）不变。
- [x] 新增 `build:node`：`bun build src/main.ts --target node --outdir dist/node --external '@opentui/*'`；
  `ws` 选择 bundle；`build:bin` 不变。
- [x] TUI/Config-TUI 的 `@opentui/react/runtime-plugin-support` 改为
  `@atom-neo/tui-kit` 的 `ensureBunRuntimePluginSupport()` 守卫：Bun 注册插件，
  Node 跳过导入。
- [x] 新增 `scripts/node-smoke/build.ts`：`dist/node/main.js` 存在、`--help` 退出 0、
  无静态 `bun:` 导入、TUI 入口在 Node 下可导入。
- 验证：`typecheck` 6/6、`typecheck:node` 0 error、源码测试 1001 pass / 21 skip /
  0 fail、全量 1781 pass / 21 skip / 0 fail、`build` 6/6、`build:node` 2.96 MB、
  Node smoke 5/5 PASS、`docs:check`/`docs:typecheck` 通过；`build:bin` 与 Node 26
  `--help` 复验通过。
**S10-B1 实施记录（2026-11-11，平台 smoke + 发布产物 smoke）**：

- [x] 新增 `scripts/node-smoke/platform.ts`：真实 Node 下覆盖 config/env
  （含 runtime overlay 与默认 config 创建）、MemoryService FTS5（`node:sqlite`、
  保存/检索/`stop()` 关闭）、BackgroundShellService（`printf` 输出/退出码/stop）、
  glob 工具（匹配与 `path` 作用域）、ScheduleService（delay + cron、
  list/persist/restore/stop）。
- [x] 新增 `scripts/node-smoke/release.ts`：直接启动已构建的 `dist/node/main.js`
  （非 source bundle），临时 sandbox + `ATOM_HTTP_RUNTIME=node`；校验
  `.atom/core-runtime.json`、`/api/health`、`/api/tui/attach`
  （`sessionId`/`serverInfo.port`）、WS `session.ready` + `ping` → `pong`、
  SIGTERM 退出 0 与 runtime 文件清理；产物缺失时明确失败，不在 smoke 内构建。
- [x] 新增 `scripts/node-smoke/run-all.ts` 与 package scripts：`smoke:node`
  （`build:node` + build check + platform + release + S9 conversation）、
  `smoke:node:platform`、`smoke:node:release`。
- 验证：`bun run smoke:node` → build check 5/5、platform 15/15、release 9/9、
  conversation 11/11；`typecheck` 6/6、`typecheck:node` 0 error、源码测试
  1001 pass / 21 skip / 0 fail、全量 1781 pass / 21 skip / 0 fail、`build` 6/6、
  `build:node` 2.96 MB、`docs:check`/`docs:typecheck` 通过；
  `node dist/node/main.js --help` 复验通过。
- [x] S10-B1 完成：platform/release smoke、`smoke:node` 编排与文档。

**S10-B2 实施记录（2026-11-11，Node 发布包 + CI + 版本）**：

- [x] 发布布局：根 `package.json` 增加 `main`、`exports`（`bun`/`node`/`default` → `dist/node/main.js`，
  `./package.json`）、`bin.atom`、`files: ["dist/node/main.js"]`、`prepack: bun run build:node`；
  `build:node` 增加 `--banner '#!/usr/bin/env node'`，构建产物可直接执行。
- [x] `workspace:*` 策略：`@atom-neo/*` 从 `dependencies` 移到 `devDependencies`
  （仅构建期，Node bundle 内联）；运行时 `dependencies` 仅保留 external
  `@opentui/core`、`@opentui/react`、`react` 与 `ws`。`bun install --frozen-lockfile`
  与 workspace typecheck/build 正常。
- [x] 新增 `scripts/node-smoke/package.ts` 与 `smoke:node:package`：build →
  `npm pack --ignore-scripts` → 校验 tarball 仅含 `package.json` +
  `dist/node/main.js`、运行时依赖无 `workspace:`、产物无静态 `bun:` 导入 →
  临时项目 `npm init -y` + `npm install <tarball> --ignore-scripts` →
  `node node_modules/atom-neo/dist/node/main.js --help` →
  `npx --no-install atom --help` → `ATOM_HTTP_RUNTIME=node` 安装态 Core
  health/SIGTERM。
- [x] 实测：`atom-neo-1.22.12.tgz` 566.9 KiB（unpacked 2.82 MiB，2 个文件）；
  安装后不存在 `node_modules/@atom-neo`；package smoke 11/11 PASS。`files`
  白名单已覆盖 `.gitignore` 的 `dist/`，无需新增 `.npmignore`。
- [x] CI：新增 `.github/workflows/ci.yml`，两个 job：
  - Bun：`bun install --frozen-lockfile`、`typecheck`、`bun test`、`build`、
    `docs:check`、`docs:typecheck`。
  - Node 26：`setup-node@v4` Node 26、`typecheck:node`、`build:node`、
    `node scripts/node-smoke/build.ts`、`smoke:node`、`smoke:node:package`。
  - Bun install 缓存按 `bun.lock`；YAML 用 Ruby Psych 本地校验通过。
- [x] 版本 bump：`package.json` 与 `src/version.ts` 1.22.11 → 1.22.12；
  `development-setup.md`/`project-structure.md` 同步发布布局、安装命令与 CI。
- 验证：`typecheck` 6/6、`typecheck:node` 0 error、源码测试 1001 pass / 21
  skip / 0 fail、全量 1781 pass / 21 skip / 0 fail、`build` 6/6、`build:bin`、
  `build:node` 2.82 MiB、`docs:check`/`docs:typecheck`、`smoke:node`
  build check 5/5 + platform 15/15 + release 9/9 + conversation 11/11、
  `smoke:node:package` 11/11、`node dist/node/main.js --help` 全部通过。
- [x] S10 完成。限制：Node TUI 仅验证入口 import，未做自动化 TUI render；
  Windows 平台 shell 行为未在 CI 覆盖。

**风险/回滚**：高；构建/发布独立，可先保留 Bun 发布。

---

### S11 — 全局状态 / DI 收口（极高）

**目标**：去掉模块级可变状态，落实 `dependency-injection.md`。

> **S11 已拆分并单独成文（已完成，v1.23.0）**：
> - [code-review-s11-2026-11-12.md](./code-review-s11-2026-11-12.md) — CR-ARCH-01..09 问题、当前/目标契约、兼容不变量
> - [code-review-s11-graph-2026-11-12.md](./code-review-s11-graph-2026-11-12.md) — 当前/目标 DI、registry/prompt/task 序列、状态机、风险与回滚
> - [code-review-s11-plan-2026-11-12.md](./code-review-s11-plan-2026-11-12.md) — A–H 子阶段、49 个 S/M 任务、测试矩阵、回滚与 DoD

**子阶段**：

| 子阶段 | 主题 | 状态 | 风险 | 依赖 | 预估 |
|---|---|---|---|---|---|
| S11-A | 类型化 `Services` + `PromptRegistry` DI | 已完成 | 中 | — | 25.5h |
| S11-B | `ElementRegistry` 实例化 | 已完成 | 中 | A5 | 15h |
| S11-C | `PipelineInstanceStore` | 已完成 | 低 | B7 | 4h |
| S11-D | TaskEngine 单循环 / 不可变 FlowState | 已完成 | 中（行为风险高） | C3 | 15h |
| S11-E | ClientManager → ProcessSupervisor | 已完成 | 中（行为风险高） | 可与 A/B 并行 | 20h |
| S11-F | TUI ThemeContext 防回归（S5 已迁移） | 已完成 | 低 | — | 1h |
| S11-G | Element 边界窄接口（CR-ARCH-07 收窄） | 已完成 | 中 | A11/B7/D4 | 14h |
| S11-H | 双实例验收 / 清理 / 文档 | 已完成 | 中 | A..G | 15.5h |

> 表中“行为风险高”只表示回归影响面；全部 49 个任务的实现复杂度均为 **简单（S）** 或 **中等（M）**。

**说明**：

- 原“5–8 天”只覆盖 A–C 的主路径；细化后基线 **110h（约 13.75 工程师日）**，关键路径 **89h**。建议按 **14–16 工程师日**排期（Core/Gateway 两人并行约 10–12 日历日）。
- CR-ARCH-04/05 已由 S9-D / S5 关闭；S11-F 只做防回归。
- CR-ARCH-07 只处理 Element 边界的 Session/Task 窄接口，全量 `any` 留给 S12。
- 任务规模、测试矩阵、回滚矩阵与 DoD 见 [S11 实施计划](./code-review-s11-plan-2026-11-12.md)，不在本文件重复。

**验收**：
- 两次 `startCore` / 并行测试不冲突。
- 全局 `let` / 模块级 `new Map` 审查通过。
- 服务缺失时启动失败，而非半初始化。
- 详见 S11 实施计划第 8 节。

**实施结果**：S11-A..H 全部完成；同进程双 `startCore`、双 registry/prompt/store、TaskEngine/Supervisor 矩阵与全局残留 guard 均通过；源码/全量测试、typecheck、build、Node smoke 与 docs 检查通过；版本 1.23.0。

**风险/回滚**：极高；按 A–H 子阶段拆 PR，每任务单 commit；过渡包装保留旧路径直到对应测试全绿。

**变更记录**：

- 2026-11-12：S11 拆分完成，新增三份 S11 文档（问题/图/计划）；子阶段 A–H、49 个任务均为 S/M；仅文档，未实施、未改源码。
- 2026-11-12：S11 全部完成（v1.23.0）：A 类型化 Services/Prompt DI、B ElementRegistry、C PipelineInstanceStore、D TaskEngine 单循环/不可变 FlowState、E ProcessSupervisor、F Theme guard、G Element 窄接口、H 双实例验收/清理/文档；CR-ARCH-01/02/03/06/08/09 关闭，04/05 防回归，07 收窄完成。

---

### S12 — 巨型文件与 TUI 结构重构（极高）

**目标**：在 Provider/Runtime/DI 稳定后做纯结构拆分，不改行为、不改契约。

> **S12 已拆分并单独成文（待实施，2026-11-12）**：
> - [code-review-s12-2026-11-12.md](./code-review-s12-2026-11-12.md) — CR-STR-01..11、CR-ARCH-10/11/12、CR-DUP-11/12 问题、当前/目标结构、行为不变量与验收
> - [code-review-s12-graph-2026-11-12.md](./code-review-s12-graph-2026-11-12.md) — 当前/目标模块图、stream/memory/context/persistence/TUI 序列、阶段 DAG、风险与回滚
> - [code-review-s12-plan-2026-11-12.md](./code-review-s12-plan-2026-11-12.md) — A–H 子阶段、97 个 S/M 任务、测试矩阵、回滚与 DoD

**子阶段**：

| 子阶段 | 主题 | 状态 | 任务数 | S/M | 预估 | 依赖 | 主要 CR |
|---|---|---|---:|---:|---:|---|---|
| S12-A | `stream-llm` 行为快照 + 模块提取 | 待实施 | 16 | 7/9 | 45h | — | CR-STR-01, CR-ARCH-12, CR-DUP-11 |
| S12-B | `memory-service` 拆分 | 待实施 | 7 | 3/4 | 17.5h | — | CR-STR-03 |
| S12-C | `context-service` 拆分 | 待实施 | 9 | 6/3 | 21.5h | — | CR-STR-04 |
| S12-D | `persistence-service` 拆分 | 待实施 | 8 | 3/5 | 21.5h | — | CR-STR-05 |
| S12-E | Core 纯函数 / ProcessSupervisor 残余 / DUP | 待实施 | 18 | 12/6 | 38.5h | E17←A3 | CR-STR-06/07, CR-DUP-11/12 |
| S12-F | TUI chat store / useChat / ChatView | 待实施 | 10 | 6/4 | 23h | — | CR-STR-08 |
| S12-G | TUI panels / App Modal / Wizard | 待实施 | 25 | 14/11 | 59.5h | F1/F6 后 | CR-STR-09/10, CR-ARCH-10/11 |
| S12-H | 行数与行为验收 | 待实施 | 4 | 1/3 | 11h | A..G | 全部 |
| **合计** | | | **97** | **52/45** | **237.5h** | | |

**说明**：

- 原“8–12 天”只覆盖 A+B+C 的主路径；细化后基线 **237.5h（约 29.7 工程师日）**，TUI 轨道 F+G 82.5h，Core 轨道 A-E 144h。建议按 **3–4 人、12–15 个工作日**排期；单人约 6–7 周。
- **CR-STR-02 已由 S8 关闭**：`server.ts` 108 行，S12 不再触碰。
- **CR-STR-11 已由 S5 关闭**：`@atom-neo/tui-kit` 已存在，S12 只消费其导出。
- **CR-STR-06 已由 S11-E 缩减**：`ClientManager` 106 行；仅 `ProcessSupervisor` 411 → ≤280 的行数收尾，状态机/重启/健康语义不变。
- CR-ARCH-12 与 CR-STR-01 是同一工作，不重复实施。
- 全仓库 ≤300 行**不是** S12 承诺：`protocol.ts` 313、`session/context.ts` 309 为显式例外；`ws-client.ts` 304 由 S12-F10 收尾。
- 任务规模、测试矩阵、回滚矩阵与 DoD 见 [S12 实施计划](./code-review-s12-plan-2026-11-12.md)，不在本文件重复。

**验收**：

- 拆分前后行为快照一致；事件顺序、DB/文件格式、HTTP/WS 路由与 Task/Event 契约不变。
- S12 目标文件 ≤300 行、目标函数 ≤100 行；`stream-llm.ts` ≤220、`process-supervisor.ts` ≤280。
- 每个任务单 commit 可回滚；新增目录有 README。
- 详见 S12 实施计划第 8 节。

**风险/回滚**：极高（仅回归影响面）；按 A–H 子阶段拆 PR，每任务单 commit；先快照后搬移，facade 保留到阶段末。

**变更记录**：

- 2026-11-12：S12 拆分完成，新增三份 S12 文档（问题/图/计划）；A–H 共 97 个任务均为 S/M；标注 CR-STR-02/11 已关闭、CR-STR-06 已缩减；仅文档，未实施、未改源码。

---

## 4. 可并行 / 必须串行

### 可并行

- S4（文档）与 S2/S3 完全独立。
- S5（TUI kit）与 S2/S3 独立，但需在 TUI 结构重构前完成。
- S7（Provider）与 S9（HTTP/WS）可并行，但 S7 必须先于 S12 的 `stream-llm` 拆分。

### 必须串行

```text
S1 → S2 → S9 → S10
S1 → S3 → S7 → S8 → S9
S6 → S8
S10 → S11 → S12
S7 → S12（stream-llm）
S5 → S12（TUI）
```

---

## 5. 每阶段 Definition of Done

一个阶段完成必须同时满足：

- [ ] 目标 CR 全部关闭或有明确遗留说明。
- [ ] 新增/更新对应测试。
- [ ] `bun run typecheck` 通过。
- [ ] `bun test` 全量通过（或记录已知失败基线）。
- [ ] 运行时相关阶段：Node smoke 通过。
- [ ] 文档相关阶段：`check-docs` 通过。
- [ ] 无新增 `any`（或已记录理由）。
- [ ] 无新增模块级可变状态（S11 后严格执行）。
- [ ] PR 描述包含：关联 CR ID、风险、回滚方式、验证命令。

---

## 6. 首个 PR 建议

**PR-1：基线 + P0 正确性修复**

范围：

- S0 基线记录。
- `CR-COR-01`、`CR-COR-03`、`CR-COR-04`、`CR-COR-05`、`CR-COR-08`。
- 不碰 `server.ts` 大改（CR-COR-02/06 可放 PR-2，避免与 S8 冲突）。

**理由**：这些都是局部、可测试、低耦合的修复；先建立“小步提交”的节奏。

**PR-2：config-tui + server 生命周期 P0**

- `CR-COR-01/02/06/07/10/11`。
- 补失败注入与并发测试。

---

## 7. 验收命令汇总

```bash
# 类型
bun run typecheck

# 全量测试
bun test

# 目标测试
bun test src/packages/core/src/session
bun test src/packages/config-tui/src/wizard-logic.test.ts
bun test src/packages/core/src/server.test.ts

# Bun 运行
bun run src/main.ts --mode core --sandbox ./sandbox

# Node 运行（S9+）
node dist/node/main.js --mode core --sandbox ./sandbox

# 文档（S4+）
bun run docs
node dist/node/docs-server.js

# 检查
rg -n 'Bun\.' src --glob '!**/dist/**' --glob '!**/node_modules/**'
bun run scripts/check-docs.ts
bun run scripts/check-file-headers.ts
```

---

## 8. 风险与回滚矩阵

| 阶段 | 回滚方式 | 备注 |
|---|---|---|
| S1 | 按文件 revert | 局部修复 |
| S2 | 按 2a/2b/2c 拆分 revert | S2c SQLite 可回退 `bun:sqlite` |
| S3 | 保留旧配置读取路径一个版本 | 双写/双读过渡 |
| S4 | 从 git 恢复旧 JSX 文档站 | 删除前先打 tag |
| S5 | 保留旧 Modal 一个版本 | 先接入再删除 |
| S6 | 保留旧事件常量映射 | 双发/双读过渡 |
| S7 | 配置 protocol 默认推断 | 旧配置不破坏 |
| S8 | 纯搬移，按模块 revert | 行为不变 |
| S9 | 保留 Bun adapter 与默认入口 | Node 通过 `ATOM_HTTP_RUNTIME=node` 可选 |
| S10 | 保留 Bun 发布流程 | Node 构建独立 |
| S11 | 按 registry/prompt/service/engine 拆分 | 风险最高 |
| S12 | 单文件/单模块 revert | 特性测试先行 |

---

## 9. 暂不做（与禁区一致）

- 不删除未实现的 5 个兼容 Element。
- 不删除 follow-up Element。
- 不删除 Replay / PipelineRunner / PipelineManager / CommandPalette / useCopied。
- 不为 `node:fs/path/crypto` 造抽象。
- 不迁移全部 `bun:test` 到 Node。
- 不引入 DI 容器。
- 不做全量 Provider 插件化。

---

## 10. 进度追踪

| 阶段 | 状态 | PR | 备注 |
|---|---|---|---|
| S0 | 已完成 | — | 基线：typecheck/build 5/5；测试 1430 pass / 21 skip / 0 fail；Node 26 + Bun 1.4.2 验证 `node:sqlite` FTS5、`fs.glob` |
| S1 | 已完成 | — | CR-COR-01..11 全部处理；测试 1453 pass / 21 skip / 0 fail；新增 service-manager/index 测试 |
| S2 | 已完成 | — | CR-RUN-01..05（非 Server）全部处理；源码测试 848 pass / 21 skip / 0 fail（`bun test` 含既有 dist 副本时 1492 pass）；新增 `string-width`、`croner`；Node smoke 通过；版本 1.22.2；剩余 `Bun.serve`/`Bun.Server` 待 S9 |
| S3 | 已完成 | — | 共享配置契约、env/原子写/helpers、类型收口；测试 1600 pass / 21 skip / 0 fail（源码 904）；版本 1.22.3；文件命名/文件头延后 S3b |
| S4 | 已完成 | — | Markdown → HTML 服务；删除 JSX 文档站；records 归档与 Context/启动/Skill 文档收敛；`docs:check`/`docs:typecheck` 通过；Bun/Node smoke 通过；版本 1.22.5 |
| S5 | 已完成 | — | 新增 `@atom-neo/tui-kit`：统一主题/Modal/FieldInput/SelectableRow；Modal 状态与键盘修复；两包删除副本；typecheck 6/6、build 6/6、测试 1624 pass / 21 skip / 0 fail（源码 922）；版本 1.22.6 |
| S6 | 已完成 | — | CR-DUP-08/CR-COR-10/CR-ARCH-15/CR-DOC-08：单一事件目录、TaskSubmissionService、typed protocol/TUI 路由；typecheck/build 6/6，`docs:check`/`docs:typecheck` 通过；测试 1672 pass / 21 skip / 0 fail（源码 946）；版本 1.22.7 |
| S7 | 已完成 | — | CR-PRO-01..06：protocol/工厂/options/prompt 语言/AgentsCompiler/API Key 隔离；四 Provider 构造与 fake 测试；typecheck/build 6/6，`docs:check`/`docs:typecheck` 通过；测试 1701 pass / 21 skip / 0 fail（源码 961）；版本 1.22.8 |
| S8 | 已完成 | — | server 拆分：`bootstrap`/`pipeline-factory`/`task-lifecycle`/`http-router`/`mcp-lifecycle`；`startCore` 853→102 行；新增路由与回滚测试；typecheck/build 6/6，测试 1717 pass / 21 skip / 0 fail（源码 969）；版本 1.22.9 |
| S9 | 已完成 | — | 双运行时 HTTP/WS 完成：S9-A 契约/spike；S9-B Bun adapter；S9-C Node adapter；S9-D Node 入口与运行时选择；S9-E Node fake conversation smoke（11 项 PASS）、Bun→Node cross-runtime（7 项 PASS）、adapter/Core smoke 各 9 项；fixture 清理；残留检查仅 Bun adapter 保留 `Bun.serve`/`requestIP`；typecheck/build 6/6，源码 1001 pass / 21 skip / 0 fail，全量 1781 pass；版本 1.22.10；1.22.11 起 Node 支持下限 26；保留双 adapter，S10 再评估统一 |
| S10 | 已完成 | — | S10-A：`tsconfig.node.json`/`typecheck:node`、`build:node` → `dist/node/main.js`、Node TUI import guard、Node build smoke；S10-B1：platform smoke（config/env/memory FTS5/shell/glob/schedule）、release artifact smoke（health/attach/WS/SIGTERM）、`smoke:node` 编排；S10-B2：`main`/`exports`/`bin`/`files`、`@atom-neo/*` 发布策略、`prepack`、tarball 安装 smoke（11/11）、CI 双 job、版本 1.22.12；TUI render 自动化列为后续 |
| S11 | 已完成 | — | A–H 全部完成，v1.23.0：CoreServices/Prompt DI、ElementRegistry、PipelineInstanceStore、TaskEngine 单循环/不可变 FlowState、ProcessSupervisor、Theme guard、Element 窄接口；新增同进程双 `startCore` 验收与全局残留 guard；双 registry/prompt/store 隔离、TaskEngine/Supervisor 矩阵通过；过渡符号 0 残留；workspace 包版本不变；源码 1095 pass / 21 skip / 0 fail，全量 1968 pass / 21 skip / 0 fail，typecheck 6/6、typecheck:node 0 error、build 6/6，Node/package smoke 与 docs 检查通过 |
| S12 | 已拆分，待实施 | — | 97 个 S/M 任务（52 简单 / 45 中等），237.5h；CR-STR-02/11 已关闭、CR-STR-06 已缩减；详见三份 S12 文档 |

> 每完成一个阶段，更新本表与 `code-review-2026-11-10.md` 的变更记录。
