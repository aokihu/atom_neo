# Atom Neo Code Review — 2026-11-10

> **Baseline**: `main` @ `e9b9452` (v1.22.0)
> **Review branch**: `code-review/2026-11-10`
> **Scope**: `src/` 下 339 个 TS/TSX 文件（不含 `dist`、`node_modules`）；生产代码约 23.7k 行，测试约 12.5k 行 / 98 个文件。
> **Status**: 只记录问题、文件与目标代码，不改动源码。
> **Related**:
> - [code-review-graph-2026-11-10.md](./code-review-graph-2026-11-10.md)
> - [code-review-plan-2026-11-10.md](./code-review-plan-2026-11-10.md)

---

## 0. 使用说明

1. 每个问题有稳定 ID（`CR-*`），后续提交信息、计划、测试统一引用 ID。
2. `当前` 代码来自基线提交；`目标` 是改造方向，不要求逐字照抄。
3. 代码片段只保留关键部分，省略号表示未改动内容。
4. 行号会随重构漂移；定位时优先搜索代码锚点（函数名/常量名）。
5. 计划顺序见 `code-review-plan-2026-11-10.md`，关系图见 `code-review-graph-2026-11-10.md`。
6. **禁区**见文末第 10 节：未实现的 Element 暂不修改。

### 严重度

| 级别 | 含义 | 处理阶段 |
|---|---|---|
| P0 | 数据丢失、错误状态、平台 bug | 阶段 1 |
| P1 | 高重复、文档失真、契约不一致 | 阶段 2–7 |
| P2 | 架构耦合、全局状态、流程复杂 | 阶段 8–11 |
| P3 | 巨型文件、结构性重构 | 阶段 12 |

### 问题统计

| 类别 | 数量 | 说明 |
|---|---:|---|
| P0 正确性 | 11 | 先修，独立可回滚 |
| 重复/去重 | 12 | Modal、主题、配置、env、原子写、helpers、类型、事件 |
| 命名/注释 | 11 | 文件命名、缩写、布尔、文件头、失效注释 |
| 文档 | 10 | Web 双轨、记录混放、架构失真、断链 |
| 架构/流程 | 15 | 全局状态、DI、Engine、Server、TUI 流程 |
| 运行时/Node | 10 | Bun API、HTTP/WS、构建、发布 |
| Provider | 6 | 硬编码 DeepSeek、Prompt 语言、Provider options |
| 结构重构 | 11 | 巨型文件拆分与 TUI 结构 |

---

## 1. P0 正确性 / 数据安全

### CR-COR-01 — `config-tui` 写入未 await，向导可能提前报告成功

**位置**: `src/packages/config-tui/src/wizard-logic.ts:326-402`

**当前**:

```ts
export function commit(sandboxPath: string, state: WizardState): void {
  // ...
  merged.tui = { theme: state.theme };

  Bun.write(`${sandboxPath}/config.json`, JSON.stringify(merged, null, 2) + "\n");

  if (Object.keys(state.envKeys).length > 0) {
    writeEnvKeys(`${sandboxPath}/.env`, state.envKeys);
  }

  if (state.mode === "first-run") {
    // ...
    Bun.write(`${sandboxPath}/AGENTS.md`, template);
    mkdirSync(`${sandboxPath}/.atom`, { recursive: true });
    Bun.write(`${sandboxPath}/.atom/installed`, "");
  }
}
```

**问题**:
- `commit()` 是同步 `void`，但 4 处 `Bun.write` 未 await。
- `WizardApp.save()` 立即 `onComplete()`，`startWizard` 可能先 resolve，进程随后退出，写入丢失。
- `merged.tui = { theme }` 会丢掉 `tui` 下未知字段，与注释/文档承诺相反。

**目标**:

```ts
import { writeFileSync } from "node:fs";

export async function commit(sandboxPath: string, state: WizardState): Promise<void> {
  // ...
  merged.tui = { ...(existing.tui ?? {}), theme: state.theme };

  writeFileSync(
    `${sandboxPath}/config.json`,
    JSON.stringify(merged, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 },
  );

  if (Object.keys(state.envKeys).length > 0) {
    writeEnvKeys(`${sandboxPath}/.env`, state.envKeys);
  }

  if (state.mode === "first-run") {
    // ...
    writeFileSync(`${sandboxPath}/AGENTS.md`, template, "utf8");
    mkdirSync(`${sandboxPath}/.atom`, { recursive: true });
    writeFileSync(`${sandboxPath}/.atom/installed`, "", "utf8");
  }
}
```

**验收**: 写入失败时向导保持打开并显示错误；`tui` 未知字段 round-trip 测试；不产生未处理 rejection。

---

### CR-COR-02 — Task.Completed 保存失败时消息/Token 未回滚

**位置**: `src/packages/core/src/server.ts:377-430`

**当前**:

```ts
if (sid && output) {
  const msg = { /* ... */ };
  sessionStore.get(sid).addMessage(msg);
  // ...
}
if (sid && result.tokenUsage) {
  sessionStore.get(sid).addTokenUsage(result.tokenUsage.total);
}
// ...
const checkpointed = !sid || sessionStore.save(sid, "task_completed");
if (!checkpointed) {
  if (completedBudget) completedBudget.completed = previouslyCompleted;
  if (completedBudget && releasedReceipt) completedBudget.lastReleasedTask = releasedReceipt;
  if (sid && result.budgetBefore) {
    sessionStore.get(sid).executionBudget = result.budgetBefore;
    result.budgetBefore.pause = "unknown"; result.budgetBefore.resuming = false;
  }
  // 消息和 tokenUsage 没有回滚
}
```

**问题**: 保存失败后，assistant 消息与 token 用量已进入 Session，失败任务污染后续上下文/计费。

**目标**:

```ts
const session = sid ? sessionStore.get(sid) : undefined;
const before = session
  ? { messageCount: session.messages.length, tokenUsage: session.tokenUsage }
  : undefined;

// addMessage / addTokenUsage ...

const checkpointed = !sid || sessionStore.save(sid, "task_completed");
if (!checkpointed && session && before) {
  session.messages.splice(before.messageCount);
  session.tokenUsage = before.tokenUsage;
  // 预算回滚保持现有逻辑
}
```

**验收**: 注入 save 失败，断言消息数、tokenUsage、预算全部回到调用前。

---

### CR-COR-03 — MemoryService 构造器开库、不关闭、retain 更新错误

**位置**: `src/services/memory-service.ts:58-66, 305-318, 342-348`

**当前**:

```ts
constructor(params: { dbPath: string; legacyNodesPath?: string; now?: () => number }) {
  super();
  this.#db = new Database(params.dbPath);
  this.#legacyNodesPath = params.legacyNodesPath;
  this.#now = params.now ?? Date.now;
  const searchIndexCreated = this.#initDb();
  if (searchIndexCreated) this.#db.run("INSERT INTO memory_fts(memory_fts) VALUES ('rebuild')");
  this.#migrateLegacyContent();
}

retain(id: string): void {
  // ...
  this.#db.run(
    `UPDATE nodes SET
       base_weight = MIN(100, base_weight + 10),
       weight = MIN(100, base_weight + 10),
       last_confirmed_at = ?,
       accessed_at = ?
     WHERE id = ?`,
    [now, now, fullMemoryId],
  );
}

async start(): Promise<void> { await super.start(); }
async stop(): Promise<void> { await super.stop(); }
```

**问题**:
- 构造器执行 I/O/迁移，违反 `docs/standards/dependency-injection.md`。
- `stop()` 不关闭数据库。
- `weight = base_weight + 10` 不是增量更新；SQLite UPDATE 使用旧值，可能降低已有 weight。

**目标**:

```ts
constructor(params: { dbPath: string; legacyNodesPath?: string; now?: () => number }) {
  super();
  this.#dbPath = params.dbPath;
  this.#legacyNodesPath = params.legacyNodesPath;
  this.#now = params.now ?? Date.now;
}

async start(): Promise<void> {
  mkdirSync(dirname(this.#dbPath), { recursive: true });
  this.#db = new DatabaseSync(this.#dbPath);
  const searchIndexCreated = this.#initDb();
  if (searchIndexCreated) this.#db.exec("INSERT INTO memory_fts(memory_fts) VALUES ('rebuild')");
  this.#migrateLegacyContent();
  await super.start();
}

async stop(): Promise<void> {
  this.#db?.close();
  this.#db = undefined;
  await super.stop();
}
```

`retain` 的 SQL 改为：

```sql
base_weight = MIN(100, base_weight + 10),
weight = MIN(100, weight + 10),
```

**验收**: 构造器无文件副作用；`start/stop` 可重复；retain 连续调用 weight 单调不减；FTS5 迁移测试。

---

### CR-COR-04 — ServiceManager 吞掉启动失败，BaseService 提前置 running

**位置**: `src/services/service-manager.ts:12-31`、`src/services/base-service.ts:15`

**当前**:

```ts
async startAll(): Promise<void> {
  for (const [name, svc] of this.#services) {
    try { await svc.start(); }
    catch (err) { this.#logger?.error(`Service "${name}" start failed`, { error: String(err) }); }
  }
}

async start(): Promise<void> { this.#running = true; }
```

**问题**: Memory/Skill 启动失败后 Core 仍继续启动；子类先 `super.start()` 再初始化，失败时 `isRunning` 仍为 true。

**目标**:

```ts
async startAll(): Promise<void> {
  const started: BaseService[] = [];
  try {
    for (const [name, svc] of this.#services) {
      await svc.start();
      started.push(svc);
    }
  } catch (error) {
    for (const svc of started.reverse()) {
      await svc.stop().catch(() => {});
    }
    throw error;
  }
}
```

BaseService 用 `onStart/onStop` 钩子，或要求子类在初始化完成后最后调用 `super.start()`。

**验收**: 注入一个 start 抛错的服务，断言已启动服务被 stop、Core 启动失败。

---

### CR-COR-05 — PipeSink 使用 Linux 专属 `O_NONBLOCK`

**位置**: `src/packages/shared/src/log/sinks/pipe.ts:5-6, 18`

**当前**:

```ts
const O_WRONLY = 1;
const O_NONBLOCK = 0o4000;
// ...
this.#fd = openSync(this.#path, O_WRONLY | O_NONBLOCK);
```

**问题**: macOS 的 `O_NONBLOCK` 是 `4`，不是 `0o4000`；命名管道日志可能打开失败或阻塞，且被 `catch { return; }` 静默丢弃。

**目标**:

```ts
import { constants, openSync } from "node:fs";
// ...
this.#fd = openSync(this.#path, constants.O_WRONLY | constants.O_NONBLOCK);
```

**验收**: macOS/Linux 下写命名管道日志；打开失败时至少 warn 一次。

---

### CR-COR-06 — MCP 异步初始化在 stop 后仍可能创建 timer/client

**位置**: `src/packages/core/src/server.ts:196-227`

**当前**:

```ts
if (mcpConfigs.length > 0) {
  initMCPClients(mcpConfigs, logger).then(async ({ clients, matchedConfigs }) => {
    // ...
    const healthStop = startMCPHealthCheck(/* ... */);
    mcpHealthStopRef.current = healthStop;
  }).catch(/* ... */);
}
const mcpHealthStopRef = { current: () => {} };
```

**问题**: `stop()` 先调用 `mcpHealthStopRef.current()`；若初始化稍后完成，会覆盖 ref 并创建 health timer，之后无人关闭。`mcpHealthStopRef` 声明在使用之后，可读性差。

**目标**:

```ts
const mcpHealthStopRef = { current: () => {} };

if (mcpConfigs.length > 0) {
  initMCPClients(mcpConfigs, logger).then(async ({ clients, matchedConfigs }) => {
    if (stopping) {
      await closeMCPClients(clients);
      return;
    }
    // ...
    const healthStop = startMCPHealthCheck(/* ... */);
    if (stopping) {
      healthStop();
      await closeMCPClients(clients);
      return;
    }
    mcpHealthStopRef.current = healthStop;
  }).catch(/* ... */);
}
```

**验收**: stop 与 MCP init 并发测试，断言无 timer/client 泄漏。

---

### CR-COR-07 — registerSharedElements 静默吞掉重复注册

**位置**: `src/packages/core/src/pipelines/shared/index.ts:9-12`

**当前**:

```ts
export function registerSharedElements(): void {
  try { registerElement("jev-decision", JevElement); } catch {}
  try { registerElement("token-ratio", TokenRatioElement); } catch {}
}
```

**问题**: 重复注册、非法构造器被隐藏；与其他注册点行为不一致。

**目标**:

```ts
export function registerSharedElements(): void {
  registerElement("jev-decision", JevElement);
  registerElement("token-ratio", TokenRatioElement);
}
```

若测试需要重复初始化，使用 `clearRegistry()` 或实例化 registry（见 CR-ARCH-01）。

---

### CR-COR-08 — trigram 相似度按百分比输出时少乘 100

**位置**: `src/packages/core/src/pipelines/post-conversation/elements/finalize.ts:41-47`

**当前**:

```ts
if (maxSim > STALL_THRESHOLD) {
  // ...
  return { type: PipelineResultType.Complete, task: input.task,
    output: `post-conversation: stalled — ${+maxSim.toFixed(2)}% similar to previous (reason: ${reason})` };
}
```

**问题**: `trigramSimilarity()` 返回 0..1，输出显示 `0.75%` 而不是 `75%`。

**目标**:

```ts
output: `post-conversation: stalled — ${(maxSim * 100).toFixed(2)}% similar to previous (reason: ${reason})`
```

---

### CR-COR-09 — TaskQueue/ToolRecord 无上限增长

**位置**: `src/packages/core/src/task-queue.ts:21-25, 116-118`、`src/packages/core/src/tools/tool-record-store.ts:40`

**当前**:

```ts
#completed = new Map<string, TaskStatus>();
#taskIdentity = new Map<string, Pick<TaskItem, "chainId" | "sessionId">>();
// ...
storeResult(taskId: string, status: TaskStatus): void {
  this.#completed.set(taskId, status);
}
```

**问题**: `#completed` / `#taskIdentity` 永不清理；Session suspend 时 `persistence.toolRecords` 不释放，长时间运行内存增长。

**目标**:
- `#completed` 设上限（例如 5000），超出按插入顺序淘汰。
- `ToolRecordStore` 提供 `pruneSession(sessionId, keepLatestGroups)`，或在 `SessionStore.#suspend` 后调用 `removeSession`（依赖 checkpoint 已持久化）。

**验收**: 连续创建 10k 任务后内存/Map 大小有界；suspend/restore 后工具记录可恢复。

---

### CR-COR-10 — WS `task.submit` 忽略 `pipeline`，且与 HTTP 提交行为不同

**位置**: `src/packages/core/src/ws/handler.ts:69-75`、`src/packages/core/src/api/tasks.ts:23-58`

**当前**:

```ts
const task = createTaskItem({
  sessionId: sid,
  chatId: payload.chatId ?? "default",
  pipeline: "conversation", // 忽略 payload.pipeline
  source: TaskSource.EXTERNAL,
  payload: [{ type: "text", data: text }],
});
```

**问题**:
- `docs/communication/protocol.md` 声明 `payload.pipeline` 可为 `conversation | prediction | follow-up`。
- HTTP 默认走 `prediction`，WS 直接走 `conversation`，外部客户端绕过 Prediction/Topic/Budget 初始化。
- `payload` 未校验。

**目标**: 抽出 `TaskSubmissionService.submit()`，HTTP/WS 共用；WS 使用 `payload.pipeline ?? "prediction"`，并做 Zod 校验。

**验收**: WS 提交 `prediction`/`conversation` 两种 pipeline 均按预期执行；非法 payload 返回结构化错误。

---

### CR-COR-11 — `--wizard` 绕过解析结果，直接读 `Bun.argv`

**位置**: `src/main.ts:56,100`、`src/bootstrap/cli.ts:12-39,48`

**当前**:

```ts
const parsed = parseArguments(Bun.argv.slice(2));
// ...
if (Bun.argv.includes("--wizard")) {
  const { startWizard } = await import("@atom-neo/config-tui");
  await startWizard(args.sandbox, "first-run");
  return;
}
```

**问题**: `parseArgs` 已声明 `wizard` 选项，但 `BootArguments` 没字段；原始 argv 与解析结果可能不一致。

**目标**:

```ts
export type BootArguments = {
  // ...
  wizard: boolean;
};
// parseArguments:
wizard: values.wizard === true,

// main.ts:
if (args.wizard) { /* ... */ }
```

---

## 2. 重复功能 / 重复逻辑

### CR-DUP-01 — Modal / ModalActionBar / types 在 TUI 与 config-tui 重复

**位置**:
- `src/packages/tui/src/components/modal/{Modal.tsx,ModalActionBar.tsx,types.ts}`
- `src/packages/config-tui/src/modal/{Modal.tsx,ModalActionBar.tsx,types.ts}`

**当前**:

```ts
// tui/src/components/modal/ModalActionBar.tsx
import { useTheme } from "../App";
```

```ts
// config-tui/src/modal/ModalActionBar.tsx
import { useTheme } from "../theme";
```

```ts
// tui/src/components/modal/types.ts
export type ModalPlacement = "center" | "top" | "bottom";
export type ModalAnchorPoint = /* 9 个点 */;
export interface ModalAnchorRect { x: number; y: number; width: number; height: number; }
```

```ts
// config-tui/src/modal/types.ts
// 只有 ModalActionRole / ModalActionVariant / ModalAction / ModalProps
// 没有 ModalPlacement / ModalAnchorPoint / ModalAnchorRect
```

**问题**: 42 行 ActionBar 仅导入路径不同；Modal 约 110/171 行复制；类型已分叉（TUI 有锚点定位，config-tui 有 `hint`/高度 clamp）。同名组件能力不同。

**目标**: 新建 `@atom-neo/tui-kit`，统一导出 `Modal`、`ModalActionBar`、`ModalProps`、`ListModal`、`SelectableRow`；两包只保留必要的包装。

---

### CR-DUP-02 — 8 套主题调色板与主题名列表重复 5 处

**位置**（S5 后已收敛到 tui-kit）:
- `src/packages/tui-kit/src/theme.tsx`（原 `tui/src/theme.ts`，唯一调色板来源）
- config-tui 旧 `theme.tsx`（S5 已删除）
- `src/packages/tui/src/types.ts`（改为 re-export）
- `src/packages/tui/src/components/SettingsModal.tsx`（改用 `THEME_NAMES`）
- `src/packages/config-tui/src/wizard-logic.ts`（主题名来自 `@atom-neo/shared`）

**当前**:

```ts
// tui/src/theme.ts
export const THEMES: Record<ThemeName, ThemeColors> = {
  "edex": {
    bg: { page: "#05090c", codeBlock: "#081218", input: "#081218", popup: "#0c1b22" },
    // ...
  },
  // 8 套
};
```

```ts
// config-tui/src/theme.tsx
export const THEMES: Record<string, ThemeColors> = {
  "edex": {
    bg: { page: "#05090c", codeBlock: "#081218", input: "#081218", popup: "#0c1b22" },
    // 同样的 8 套，但没有 code.*
  },
};
```

**问题**: 约 120 个相同 hex 值；新增主题要改最多 5 处；config-tui `THEMES` 缺 code 颜色，fallback 到 `edex` 时可能静默显示错误主题。

**目标**:

```ts
// shared/src/theme/manifest.ts（无 React 依赖）
export const THEME_NAMES = ["edex", "github-dark", /* ... */] as const;
export type ThemeName = typeof THEME_NAMES[number];

// tui-kit/src/theme/palette.ts
export const THEME_PALETTES: Record<ThemeName, ThemeColors> = { /* 唯一来源 */ };
```

---

### CR-DUP-03 — 配置 Schema / Provider / 默认值多套

**位置**:
- `src/bootstrap/config.ts:5-80`（完整 schema）
- `src/packages/config-tui/src/wizard-logic.ts:59-95`（`PROVIDERS` / `THEMES` / `DEFAULT_PROFILES`）
- `src/packages/gateway/src/config.ts:3-19`（ClientConfig 子集）
- `src/services/runtime-service.ts:86`（默认模型）

**当前**:

```ts
// bootstrap/config.ts
const ProviderProfilesSchema = z.object({
  advanced: z.string().default("deepseek/deepseek-v4-flash"),
  balanced: z.string().default("deepseek/deepseek-v4-flash"),
  basic: z.string().default("deepseek/deepseek-v4-flash"),
  fast: z.string().optional(),
});
```

```ts
// config-tui/wizard-logic.ts
export const DEFAULT_PROFILES = {
  advanced: "deepseek/deepseek-v4-flash",
  balanced: "deepseek/deepseek-v4-flash",
  basic: "deepseek/deepseek-v4-flash",
};
```

**问题**: 默认值/Schema/Provider 清单可能漂移；向导可以写入 bootstrap 拒绝的值；Gateway 校验另一套。

**目标**: `shared/src/config/` 作为唯一契约；`bootstrap/config.ts` re-export；config-tui 依赖 shared；gateway 复用 ClientConfig schema。

---

### CR-DUP-04 — `.env` 解析 3 套实现

**位置**:
- `src/bootstrap/env.ts:3-18`
- `src/bootstrap/backup.ts:101-140`
- `src/packages/config-tui/src/wizard-logic.ts:258-269, 326-336`

**当前**:

```ts
// bootstrap/env.ts
const eqIdx = trimmed.indexOf("=");
if (eqIdx === -1) continue;
const key = trimmed.slice(0, eqIdx).trim();
const value = trimmed.slice(eqIdx + 1).trim();
if (!process.env[key]) process.env[key] = value;
```

```ts
// backup.ts
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
```

**问题**: `export KEY=`、引号、CRLF、注释处理不一致；向导 upsert 只匹配行首 `KEY=`，可能重复 `export KEY=`。

**目标**: `shared/src/utils/env-file.ts` 提供 `parseEnv` / `upsertEnv` / `serializeEnv`，三处共用。

---

### CR-DUP-05 — 原子写 4 套实现

**位置**:
- `src/bootstrap/backup.ts:78-89`
- `src/bootstrap/runtime-file.ts:10-20`
- `src/bootstrap/menu-history.ts:57-66`
- `src/packages/core/src/session/persistence-service.ts:469-503`

**当前**:

```ts
// backup.ts
const temporary = `${path}.tmp-${randomUUID()}`;
writeFileSync(temporary, content, { encoding: "utf8", mode, flag: "wx" });
renameSync(temporary, path);
```

```ts
// persistence-service.ts
#writeDurable(path: string, content: string): void {
  // open / write / fsync / close
}
#writeAtomic(path: string, content: string): void {
  // 再次重复 fsync 逻辑
}
```

**问题**: 权限、fsync、临时文件清理、错误处理不一致；backup/menu 崩溃时可能丢文件。

**目标**: `shared/src/utils/fs.ts` 提供 `writeFileAtomic(path, data, { mode, fsync, createDirs })`；persistence 只调用一个 durable helper。

---

### CR-DUP-06 — 通用 helpers 重复

| Helper | 重复位置 | 建议 |
|---|---|---|
| `sleep` | `shared/utils/timing.ts:1`, `gateway/server.ts:176`, `gateway/client-manager:264` | 复用 shared |
| `generateId` | `task-factory.ts:6`, `schedule-service.ts:17`, `hook-manager.ts:10` | `createId(prefix)` |
| `clamp` | 两包 `Modal.tsx:9`, `memory-ranking.ts:31` | shared utils |
| `parsePort` | `bootstrap/cli.ts:227`, `config-tui/wizard-logic.ts:435` | 统一返回判别结果 |
| `stringifyToolOutput` | `tool-loop.ts:105`, `stream-llm.ts:929` | 导出复用 |
| `truncate` | `shared/utils/string.ts:4`, `ToolMessageBox.tsx:5` | 后者改名 `toDisplayText` |
| `errorMessage` | shared 已有，但 65 处 `String(err)` | 逐步替换 |

**代码片段**:

```ts
// 当前：stream-llm.ts 与 tool-loop.ts 完全相同
function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output === undefined) return "";
  try { return JSON.stringify(output); } catch { return String(output); }
}
```

**目标**: 只保留 `tool-loop.ts` 导出版本，`stream-llm.ts` 导入。

---

### CR-DUP-07 — 领域类型多份

| 类型 | 位置 | 问题 |
|---|---|---|
| `SkillDef` / `SkillListItem` / `SkillLoadResult` | `shared/src/types/skill.ts:1-25`、`core/src/skills/types.ts:1-11`、`services/skill-parser.ts:1-17`、`services/skill-service.ts:7-17` | 3–4 份 |
| `MemoryKind` | `shared/src/types/memory.ts:3-13`、`services/memory-ranking.ts:4-11` | 2 份 |
| `MemoryNode` | `shared/src/types/memory.ts:15-26`、`services/memory-service.ts:15-33` | 同名不同形 |
| `TodoItem` | `core/src/session/context.ts:22`、`tui/src/types.ts:47` | 2 份 |
| Modal 类型 | 两包 `modal/types.ts` | 已分叉 |

**目标**: shared 作为跨包域类型唯一来源；持久化行类型显式命名（`MemoryRow`），避免同名冲突。

---

### CR-DUP-08 — 事件字符串维护 3 份

**位置**:
- `src/packages/shared/src/constants/events.ts`
- `src/packages/shared/src/types/pipeline.ts`
- `src/packages/shared/src/protocol.ts`

**当前**:

```ts
// constants/events.ts
export const BusEvents = {
  Transport: { Delta: "transport.delta" },
  Pipeline: { ElementStarted: "pipeline.element.started" },
} as const;

export const WsMessages = {
  Server: { TransportDelta: "event.transport.delta" },
} as const;
```

```ts
// types/pipeline.ts
export type PipelineEventMap = {
  "pipeline.element.started": { /* ... */ };
  "transport.delta": ReportedTransportEvent<{ textDelta: string; offset: number }>;
};
```

```ts
// protocol.ts
export type ServerEvent =
  | { type: "event.pipeline.element.started"; payload: ElementStartedPayload }
  | { type: "event.transport.delta"; payload: TransportDeltaPayload };
```

**问题**: 同一事件字符串 3 处；协议类型未覆盖全部 `WsMessages`；`conversation.chain` 实际使用 `{ name, payload }` 包装但类型声明是扁平 payload，只能 `as any`。

**目标**: 单一 `EVENTS` 常量；`WsMessages`、`PipelineEventMap`、`ServerEvent` 全部由常量/映射派生。

---

### CR-DUP-09 — 旧 JSX 文档站与 Markdown 双轨

**位置**: 旧 JSX 文档站（33 文件、6493 行）与 React SSR server

**当前**:

```tsx
export default function DocPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} ... />
      {/* 整篇文档硬编码在这里，content 只用于字数 */}
      <Section title="核心原则：少写代码，更多力量">
        {/* ... */}
      </Section>
    </div>
  );
}
```

**问题**: 32/33 页面忽略 Markdown `content`；修改 `.md` 不影响 Web 页面；与 `docs/index.md` “Markdown 唯一来源”矛盾。

**目标**: 删除旧 JSX 文档站；新建 `docs/server.ts`，用 `node:http` + `marked` + `marked-highlight` + `highlight.js` 直接渲染 Markdown。

---

### CR-DUP-10 — 测试假模型服务器重复 5 处

**位置**:
- `pipelines/conversation/elements/stream-boundaries.test.ts:28-45`
- `stream-cache.test.ts:26-45`
- `server-continuation.test.ts:32-60`
- `decision/choose.test.ts:12-20`
- `decision/jev-client.test.ts`

**目标**: `pipelines/test-helpers.ts` 提供 `createFakeModelServer(steps)`；统一 SSE/JSON 响应、关闭逻辑。

---

### CR-DUP-11 — stream-llm 内重复执行路径与 helper

**位置**: `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts:1029-1207`

**问题**:
- 内置工具与 MCP 工具各有一套治理/执行/记录流程。
- `intent` / `todowrite` 被特殊处理两次。
- `stringifyToolOutput` 与 `tool-loop.ts` 重复。
- 工具结果通过 `#toolResults` Map 侧信道传递，而不是显式返回值。

**目标**: `tool-runtime.ts` 统一 `executeGovernedTool()`，返回 `{ content, metadata, record }`；内置/MCP 只保留适配差异。

---

### CR-DUP-12 — 消息投影/过滤策略 4 套

**位置**:
- `collect-prompts.ts:43-47`
- `record-context.ts:114-117`
- `format-user-messages.ts:16-19`
- `stream-llm.ts:36-49`
- `session/message-policy.ts:11-23`
- `collect-input.ts:94-100`
- `compress-input.ts:10-13`
- `predict-input.ts:20-27`

**当前**:

```ts
// conversation/elements/types.ts
export const appendCurrentUserMessage = (messages: Message[], content?: string): Message[] => {
  const latest = messages.at(-1);
  if (content && (latest?.role !== "user" || latest.content !== content)) {
    messages.push({ role: "user", content }); // 修改输入数组
  }
  return messages;
};
```

**问题**: reasoning 保留策略不同；工具失败过滤不同；`appendCurrentUserMessage` 变异输入，两个调用方还忽略返回值。

**目标**: 纯函数 `appendCurrentUserMessage`（返回新数组）+ `projectMessages(messages, { reasoning: "keep" | "drop" | "convert" })` + 单一 `isPromptEligibleMessage` 策略。

---

## 3. 命名 / 注释

### CR-NAM-01 — 文件名不符合 kebab-case

| 当前 | 建议 |
|---|---|
| `src/packages/shared/src/prompts/model_profiles.ts` | `model-profiles.ts` |
| `src/packages/tui/src/stores/inputHistory.ts` | `input-history.ts` |
| `src/packages/tui/src/components/InputBar.tsx` | 若保留 PascalCase，需在标准中明确 React 组件例外 |
| `src/packages/config-tui/src/modal/` vs `tui/src/components/modal/` | 统一位置（tui-kit） |

### CR-NAM-02 — Finalize 类命名不统一

**当前**:

```ts
class FinalizeElement extends BaseElement<ConversationFlowState, any> {}
class PostConversationFinalizeElement extends BaseElement<PostConversationFlowState, PipelineResult> {}
class PredictFinalizeElement extends BaseElement<PredictionFlowState, PipelineResult> {}
class EvaluateFinalizeElement extends BaseElement<EvaluatorFlowState, PipelineResult> {}
class CompressFinalizeElement extends BaseElement<CompressFlowState, CompressResult> {}
```

**目标**:

```ts
class ConversationFinalizeElement {}
class PostConversationFinalizeElement {}
class PredictionFinalizeElement {}
class EvaluatorFinalizeElement {}
class CompressFinalizeElement {}
```

### CR-NAM-03 — 缩写与拼写不一致

| 现状 | 建议 |
|---|---|
| `ApiKeyInvalidError` / `apiKey` | `APIKeyInvalidError` / `apiKey`（变量可保留） |
| `JevElement` / `JEV` | 统一 `Jev` 或 `JEV`，代码内选一个 |
| `wrapMCPAiTools` | `wrapMCPTools` |
| `WebSearch` / `websearch` / `webSearch` | 函数/类型 `WebSearch`，工具名 `websearch`，文件名 `web-search.ts` |
| `WebFetch` / `webfetch` / `webFetch` | 同上，文件名 `web-fetch.ts` |

### CR-NAM-04 — `decisionMode` 两套值域

**当前**:

```ts
// conversation/index.ts
decisionMode?: "jev" | "rules";
```

```ts
// prediction/elements/types.ts
decisionMode?: "legacy" | "jev";
```

```ts
// post-conversation/index.ts
decisionMode?: "legacy" | "jev";
```

**目标**:

```ts
// shared/src/types/config.ts
export type DecisionMode = "legacy" | "jev" | "rules";
// 或按 pipeline 拆分：
export type PredictionDecisionMode = "legacy" | "jev";
export type ContinuationDecisionMode = "jev" | "rules";
```

### CR-NAM-05 — 布尔值缺 `is/has/can/should` 前缀

**例子**:

```ts
let tokenOverflow = false;
let streamFailed = false;
let timedOut = false;
let forceFinalText = false;
let contextDirty = false;
let completeDetected = false;

// TUI
busy: boolean;
showPreparing: boolean;
telemetryOnline: boolean;
quitConfirm: boolean;
interactive: boolean;
```

**目标**: `isTokenOverflow`、`hasStreamFailed`、`isTimedOut`、`shouldForceFinalText`、`isContextDirty`、`isCompleteDetected`、`isBusy`、`isPreparing`、`isTelemetryOnline`、`isQuitConfirm`、`isInteractive`。

### CR-NAM-06 — 事件 step 名称混用句子与 kebab

**当前**:

```ts
this.report(BusEvents.Element.Data, { step: "no apiKey, fallback" });
this.report(BusEvents.Element.Data, { step: "starting LLM call" });
this.report(BusEvents.Element.Data, { step: "model-step-ended" });
```

**目标**: 全部 kebab-case 且集中常量化：`no-api-key`、`llm-call-start`、`model-step-ended`。

### CR-NAM-07 — 用户可见语言混用

- CLI/菜单中文：`bootstrap/cli.ts:150-197`、`menu-flow.ts:25-78`
- backup 输出英文：`bootstrap/backup.ts:229-241`
- TUI 标签英文：`StatusBar`、`SettingsModal`
- 逻辑内硬编码中文：`check-follow-up.ts:181`、`todowrite.ts`、`shell.ts`

**目标**: 定义语言策略；用户文案集中到 `prompts`/`i18n`；代码内不硬编码用户提示。

### CR-NAM-08 — `private` 与 `#` 混用

**位置**: `gateway/client-manager/index.ts:151,207`、`bootstrap/menu-flow.ts:240`、`persistence-service.ts:108`

**目标**: 统一 `#` 私有字段（项目标准倾向）。

### CR-NAM-09 — 约 93% 生产文件缺文件头

**现状**: 规范要求每个 `.ts` 文件有 JSDoc 文件头；实际仅约 17/241 首行符合，core 抽查 100/105 缺失，TUI 51/53 缺失。

**目标模板**:

```ts
/**
 * Purpose: ...
 * Ownership: ...
 * Invariants: ...
 */
```

**验收**: CI 脚本扫描前 5 行；白名单仅生成文件/barrel（需团队决定）。

### CR-NAM-10 — 复杂文件零注释 / 失效注释

**零注释**:
- `stream-llm.ts` 1227 行，0 行注释
- `context-service.ts` 552 行，0 行注释
- `task-engine.ts` 281 行，0 行注释

**失效/误导**:
- `config-tui/wizard-logic.ts:350-353` 声称保留未知字段，实际 `merged.tui = { theme }`。
- `MenuModal.tsx:22` 写“左侧面板”，实际右侧。
- `session/README.md:15` 写“三件套”，实际 4 个文件。
- `jev-element.ts:2` 文件头注释位于 import 之后。

**目标**: 只补关键不变量（快照租约、工具状态通道、预算回滚），不做逐行注释。

### CR-NAM-11 — 复杂目录缺 README

缺失目录（15 个）:
`shared/src`、`shared/src/prompts`、`shared/src/utils`、`core/src`、`core/src/pipelines`、`core/src/ws`、`core/src/pipeline`、`core/src/hooks`、`core/src/replay`、`core/src/task`、`gateway/src`、`tui/src`、`tui/src/components`、`tui/src/stores`、`config-tui/src`。

**目标**: 每目录 1 页文件地图 + 所有权 + 禁止事项；复杂目录至少包含“文件/职责/依赖方向”。

---

## 4. 文档

### CR-DOC-01 — 删除 Web 页面双轨，保留 Markdown → HTML 服务

**现状**:
- 旧 JSX 文档站 33 文件 / 6493 行，32 个页面忽略 `content`。
- React SSR 组件与共享模块依赖 React。
- `docs/index.md` 声明 Markdown 唯一来源，但 Web 页面仍硬编码。

**目标**:
- 删除旧 JSX 文档站（pages/components/shared/server.tsx）。
- 新建 `docs/server.ts`：`node:http` + `marked`/`markdown-it` + `highlight.js`；路由直接读 `.md`；相对链接重写；路径穿越防护；可选 `--watch`。
- 新增 `scripts/check-docs.ts`：检查 Markdown 链接与反引号 `src/` 路径。

### CR-DOC-02 — 设计文档与历史记录混放

建议新增 `docs/records/`，移入:
- `records/startup-validation.md`
- `records/startup-modes-plan.md`（契约部分并入 `bootstrap.md`）
- `records/context-snapshot-cache-plan.md`
- `records/continuation-validation.md`
- `records/progress-evidence-experiment.md`
- `records/code-review-telegram-bot.md`

### CR-DOC-03 — Context 三篇重叠

`context-management.md`、`context-outcome-governance.md`、`context-snapshot-cache-plan.md`。建议治理规则并入管理文档，缓存方案移入 records。

### CR-DOC-04 — 启动四篇重叠

`bootstrap.md`、`startup-menu.md`、`startup-modes-plan.md`、`startup-validation.md`。建议合并为“启动契约 + 菜单 + 验收记录”。

### CR-DOC-05 — `skill-system-plan.md` 已被 `skill-system.md` 取代

**目标**: 归档或合并剩余任务；`docs/index.md` 移除“开始编码前”状态。

### CR-DOC-06 — `architecture.md` 声明与代码不符

| 文档声明 | 实际 |
|---|---|
| `Orchestrator + IntentPolicy + ToolCoordinator + MemoryManager` | 代码中 0 处引用 |
| Pipeline Replay 完整可用 | `PipelineRecorder/Player` 仅 barrel/测试 |
| 支持热重载 | `PipelineManager` 未接线 |
| conversation 9 元素 | 当前主链 8 元素 |
| context-compress 3 元素 | 实际 4 元素（含 token-ratio） |

**目标**: 改写为“当前实现”与“规划中”两节；未实现功能明确标注，不写成已完成。

### CR-DOC-07 — `configuration.md` 示例使用死字段 `theme`

**当前**:

```jsonc
{
  "version": 2,
  "theme": "dark",
  "tui": { "theme": "dracula" }
}
```

**问题**: 顶层 `theme` 在 `ConfigSchema` 中存在但无任何读取；实际生效为 `tui.theme`。

**目标**: 删除顶层 `theme` 示例与死字段；统一 `tui.theme`；修正默认 `basic` 模型示例（当前代码默认全部 flash）。

### CR-DOC-08 — `protocol.md` 的 Replay/TUI 提交方式失真

- 文档定义 `replay.event`，代码没有。
- 文档称 TUI 通过 WebSocket 提交任务，实际 TUI `send()` 走 `POST /api/tasks`，WS 只接收事件。
- 文档 `task.submit` 允许 `pipeline`，WS handler 硬编码 `conversation`。

**目标**: 与 CR-COR-10 / 事件统一一起修正。

### CR-DOC-09 — 约 36 处 `src/...` 路径不存在

示例:
- 'src/packages/core/pipeline/runner.ts'（旧路径；现为 `src/packages/shared/src/pipeline/runner.ts`）
- 'src/packages/tui/src/app.ts'（旧路径；现为 `src/packages/tui/src/app.tsx`）
- 'src/packages/tui/src/components/StatusBar.ts'（旧路径；现为 `src/packages/tui/src/components/StatusBar.tsx`）
- 'src/packages/core/src/tools/adapters/mcp-tool.ts'（旧路径，当前无该适配器文件）

**目标**: 文档路径检查脚本；修正 `.ts`/`.tsx` 与旧目录。

### CR-DOC-10 — `docs/index.md` 状态过期

示例: `startup-modes-plan.md` 标“已实现，待验收”，`startup-validation.md` 记录 8 通过/2 失败；当前包版本 1.22.0，文档停留 1.15–1.18。

**目标**: 索引只保留“当前状态 + 最后验证日期”；历史结果移入 records。

---

## 5. 架构 / 独立性 / 流程

### CR-ARCH-01 — Element Registry 是模块级全局

**位置**: `src/packages/core/src/pipeline/registry.ts:5`

**当前**:

```ts
const registry = new Map<string, ElementConstructor>();

export function registerElement(name: string, ctor: ElementConstructor): void {
  if (registry.has(name)) throw new Error(`Element "${name}" already registered`);
  registry.set(name, ctor);
}
```

**问题**: 两次 `startCore` 冲突；测试需 `clearRegistry()`；无法按实例隔离/替换。

**目标**:

```ts
export class ElementRegistry {
  #elements = new Map<string, ElementConstructor>();
  register(name: string, ctor: ElementConstructor): void { /* ... */ }
  resolve(name: string): ElementConstructor { /* ... */ }
  names(): string[] { return [...this.#elements.keys()]; }
}
```

bootstrap 构造并注入 `PipelineBuilder` / `PipelineManager` / `TaskEngine`。

### CR-ARCH-02 — `pipelineMap` 全局且造成分层倒置

**位置**: `src/packages/core/src/api/tasks.ts:9-21`、`src/packages/core/src/task-engine.ts:5,143-150`

**当前**:

```ts
// api/tasks.ts
const pipelineMap = new Map<string, Pipeline>();
export function getPipeline(taskId: string) { return pipelineMap.get(taskId); }
export function setPipeline(taskId: string, pipeline: Pipeline) { pipelineMap.set(taskId, pipeline); }
```

```ts
// task-engine.ts
import { getPipeline, removePipeline, setPipeline } from "./api/tasks";
```

**问题**: TaskEngine 依赖 HTTP 层；隐藏状态；测试无法隔离。

**目标**: `PipelineInstanceStore` 实例，注入 TaskEngine 与 task handler。

### CR-ARCH-03 — PromptRegistry 单例 + 懒初始化

**位置**: `src/packages/shared/src/prompts/index.ts:13-25`

**当前**:

```ts
let _instance: PromptRegistry;

export function getRegistry(): PromptRegistry {
  if (!_instance) _instance = new PromptRegistry();
  return _instance;
}
```

**目标**: bootstrap 构造 `PromptRegistry`，注册语言/模型变体；通过构造器注入或用 `PromptResolver` 函数注入。

### CR-ARCH-04 — Gateway 模块级 Logger

**位置**: `src/packages/gateway/src/server.ts:9-11`

**当前**:

```ts
const logHub = new LogHub();
logHub.addSink(new StdoutSink());
const logger = new Logger("info", (entry) => logHub.write(entry));
```

**问题**: 忽略 `--log*` 配置；import 即开始日志；无法测试。

**目标**: `startGateway({ logger })` 必需；仅进程入口创建默认 logger。

### CR-ARCH-05 — TUI Theme Context 放在 App.tsx，形成循环依赖

**位置**: `src/packages/tui/src/components/App.tsx:55-59`

**当前**:

```tsx
const ThemeContext = createContext<ThemeCtx>(getTheme());
export function useTheme() { return useContext(ThemeContext); }
```

19 个组件从 `./App` 导入 `useTheme`，而 `App.tsx` 又导入这些组件。

**目标**: 移到 `tui-kit/src/theme/context.tsx`；组件只依赖叶子模块。

### CR-ARCH-06 — ServiceManager 是字符串服务定位器

**位置**: `src/services/service-manager.ts`、`src/packages/core/src/server.ts:140-145`

**当前**:

```ts
const memory = sm.get("memory");
const skillService = sm.get<SkillServiceLike>("skill");
const network = sm.get<NetworkServiceLike>("network");
const compiler = sm.get<CompilerLike>("agents-compiler");
```

**目标**:

```ts
type Services = {
  memory: MemoryService;
  skill: SkillService;
  network: NetworkService;
  compiler: AgentsCompilerService;
};
export async function startCore(deps: CoreDeps & { services: Services }): Promise<...>
```

### CR-ARCH-07 — 具体 Session 耦合与 `any`

**现状**:
- 生产代码 `session: any` / `task: any` / `memory: any` 共 47 处。
- core 生产代码 `as any` / `: any` / `<any>` 共 172 处。

**目标**: 定义窄接口:

```ts
type ConversationSession = {
  sessionId: string;
  messages: SessionMessage[];
  todoState: TodoItem[];
  executionBudget?: ExecutionBudget;
  currentTopic?: string;
  addMessage(message: SessionMessage): void;
  // 仅暴露 Element 需要的方法
};
```

按 Element 需要切片，避免整个 SessionContext。

### CR-ARCH-08 — TaskEngine 事件重入 + 变异输入

**位置**: `src/packages/core/src/task-engine.ts:88-112, 149-164`

**当前**:

```ts
#onTaskEnqueued(): void {
  if (!this.#running || this.#processing || this.#queue.size === 0) return;
  this.#processing = true;
  Promise.resolve()
    .then(() => this.#processNext())
    .finally(() => { this.#processing = false; this.#onTaskEnqueued(); });
}

// #executeTask
current.abortSignal = abortSignal; // 修改 FlowState
```

**目标**:

```ts
async start(): Promise<void> {
  this.#running = true;
  while (this.#running) {
    const task = await this.#queue.next(); // 唤醒 Promise
    if (!task) break;
    await this.#processNext(task);
  }
}
```

FlowState 用 `{ ...current, abortSignal }` 返回新对象。

### CR-ARCH-09 — ClientManager 三种并发机制混合

**位置**: `src/packages/gateway/src/client-manager/index.ts:131-149, 151-205, 207-239, 247-261`

- `onExit` 回调
- `setTimeout` 重启
- `#serialize` Promise 串行化
- 健康检查只打日志，不重启

**目标**: `ProcessSupervisor` 状态机（`idle | starting | running | stopping | failed`），一个调度源；健康检查触发与 exit 相同的重启策略。

### CR-ARCH-10 — TUI App Modal 7 个三元表达式

**位置**: `src/packages/tui/src/components/App.tsx:156-199`

每个属性单独 `activeModal.kind === ...` 分支。**目标**: `MODAL_CONFIG` 表或每类 Modal 一个小组件。

### CR-ARCH-11 — WizardApp 10 处重复路由守卫

**位置**: `src/packages/config-tui/src/components/WizardApp.tsx:121-226`

`!quitConfirm && view === "..."` 重复 10 次；`WizardState.step` 只写不读。**目标**: `useReducer` + 判别联合路由。

### CR-ARCH-12 — `stream-llm.ts` God Function

**位置**: `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts:198-896`

**当前**:

```ts
async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
  // 15+ mutable let
  // while (modelStep <= maxSteps) { stream; parse; tool calls; governance; ... }
  // 内置/MCP 两套执行路径
  // 工具结果通过 #toolResults Map 侧信道
}
```

**目标**: `stream-loop.ts` + `tool-runtime.ts` + `stream-reporting.ts`；Element < 300 行；StepOutcome 判别联合。

### CR-ARCH-13 — `server.ts` God Function

**位置**: `src/packages/core/src/server.ts:116-793`

`startCore` 同时做组合根、HTTP 路由、MCP 生命周期、Task.Completed、pipeline 构造。**目标**: `bootstrap.ts`、`pipeline-factory.ts`、`task-lifecycle.ts`、`http-router.ts`、`mcp-lifecycle.ts`。

### CR-ARCH-14 — 未接线/死代码

| 代码 | 状态 | 处理 |
|---|---|---|
| `PipelineRunner` | 仅 shared 导出，无调用 | 暂不删除，文档标注未接线 |
| `PipelineManager` | 仅 barrel/test | 暂不删除 |
| `PipelineRecorder/Player` | 仅 barrel/test | 暂不删除 |
| `followUpPipeline` | 无调用 | 暂不删除（禁区） |
| 5 个兼容 Element | 注册但不在主链 | **不动**（禁区） |
| `CommandPalette` | 无导入 | 暂不删除 |
| `useCopied` | 只写不读 | 暂不删除 |
| `ConfigSchema.theme` | 无读取 | 可删除（CR-DOC-07） |
| `base_system_prompt.md` | 文件头标 DEPRECATED，无引用 | 可归档，不属于 Element |

### CR-ARCH-15 — WS/HTTP 提交路径分歧

见 CR-COR-10；同时消除 `server.ts` 与 `ws/handler.ts` 各自的 session/checkpoint/enqueue 逻辑。

---

## 6. 运行时 / Node 支持

### 6.1 Bun API 清单与目标

| API | 生产位置 | 目标 |
|---|---|---|
| `Bun.write` | `bootstrap/agents.ts:14`、`config.ts:160,209`、`first-run.ts:11`、`config-tui/wizard-logic.ts:335,376,396,399` | `writeFileSync` / `fs.promises.writeFile` |
| `Bun.argv` | `main.ts:56,100` | `process.argv` + `BootArguments.wizard` |
| `Bun.main` | `bootstrap/cli.ts:148,223` | `import.meta.main` / `process.argv[1]` |
| `Bun.env` | `gateway/config.ts:25,26,29` | `process.env` |
| `Bun.stringWidth` | `bootstrap/menu.ts:8-46` | `string-width` |
| `Bun.sleep` | `tools/builtin/shell.ts:154` | shared `sleep` |
| `Bun.spawn` / `Bun.Subprocess` | `bootstrap/first-run.ts:19`、`gateway/client-manager:160`、`tools/builtin/shell.ts:12,50` | `node:child_process` + `ProcessHandle` |
| `Bun.Glob` | `tools/builtin/fs.ts:217` | `fs.glob` / `fs.globSync` |
| `Bun.cron` | `tools/schedule-service.ts:56,114,173,186,220` | `croner` |
| `bun:sqlite` | `services/memory-service.ts:3` | `node:sqlite` 包装 |
| `Bun.serve` / `Bun.Server` | `core/server.ts:619,654`、`gateway/server.ts:102` | `HttpServer` 端口或统一 `node:http + ws` |
| `ServerWebSocket` (type) | `core/ws/handler.ts:1`、`broadcaster.ts:1` | 自有 `WebSocketPeer` |
| `srv.requestIP` | `shared/utils/admin-auth.ts:8` | `RequestContext.ip` |
| `import.meta.main` | `main.ts:239`、`gateway/server.ts:180` | Node 26+ 与 Bun 均支持，保留 |

### CR-RUN-01 — 统一 `writeFile` 与原子写

见 CR-COR-01 / CR-DUP-05。目标 `shared/src/utils/fs.ts`。

### CR-RUN-02 — `Bun.spawn` → `node:child_process`

**当前**:

```ts
return Bun.spawn({
  cmd: ["sh", "-c", params.command],
  cwd: params.root,
  env: createChildProcessEnv(),
  stdin: "ignore",
  stdout: "pipe",
  stderr: "pipe",
  killSignal: "SIGKILL",
});
```

**目标**:

```ts
import { spawn } from "node:child_process";

export function spawnShell(params: {
  root: string;
  command: string;
  signal?: AbortSignal;
}): ProcessHandle {
  const child = spawn("sh", ["-c", params.command], {
    cwd: params.root,
    env: createChildProcessEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  // ProcessHandle: pid, stdout, stderr, exited, exitCode, kill()
}
```

### CR-RUN-03 — `Bun.Glob` → `fs.glob`

**当前**:

```ts
const glob = new Bun.Glob(p.pattern);
for await (const filepath of glob.scan({ cwd: target, absolute: false })) { /* ... */ }
```

**目标**:

```ts
import { promises as fs } from "node:fs";
for await (const filepath of fs.glob(p.pattern, { cwd: target })) { /* ... */ }
```

### CR-RUN-04 — `Bun.cron` → `croner`

**当前**:

```ts
const nextFireAt = task.nextFireAt ?? (type === "delay" ? now + delayMs
  : type === "interval" ? now + intervalMs
  : Bun.cron.parse(schedule)?.getTime());
```

**目标**:

```ts
import { Cron } from "croner";
const nextFireAt = new Cron(schedule, { paused: true }).nextRun()?.getTime();
```

### CR-RUN-05 — `bun:sqlite` → `node:sqlite`

**当前**:

```ts
import { Database } from "bun:sqlite";
this.#db = new Database(params.dbPath);
this.#db.run(`UPDATE ...`, [params]);
```

**目标**:

```ts
import { DatabaseSync } from "node:sqlite";

export class SqliteDatabase {
  #db: DatabaseSync;
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    return this.#db.prepare(sql).run(...(params ?? []));
  }
  prepare(sql: string) { return this.#db.prepare(sql); }
  exec(sql: string): void { this.#db.exec(sql); }
  close(): void { this.#db.close(); }
}
```

本机已验证 Node 26 与 Bun 1.4.2 均支持 `node:sqlite` + FTS5；需在阶段 0 确认最低 Bun/Node 版本。

### CR-RUN-06 — HTTP/WebSocket 运行时

> S9 已单独成文：[问题与契约](./code-review-s9-2026-11-11.md)、[关系图](./code-review-s9-graph-2026-11-11.md)、[实施计划](./code-review-s9-plan-2026-11-11.md)。本节保留原始问题摘要。

**当前**:

```ts
let server: Bun.Server<unknown> | undefined;
server = Bun.serve<unknown>({
  port, hostname: host,
  async fetch(req, srv) {
    if (url.pathname.startsWith("/ws/")) {
      srv.upgrade(req, { data: { sessionId: sid } });
    }
  },
  websocket: wsHandlers,
});
```

**目标（方案 A，推荐先验证）**: 统一 `node:http` + `ws`，Bun/Node 共用。

**目标（方案 B）**: 定义端口:

```ts
export interface HttpServer {
  serve(options: {
    port: number;
    host: string;
    fetch(req: Request, ctx: RequestContext): Promise<Response>;
    websocket?: WebSocketHandlers;
  }): Promise<ServerHandle>;
}

export interface WebSocketPeer {
  data: { sessionId?: string; chatId?: string };
  send(data: string): void;
  close(): void;
}
```

Bun 实现用 `Bun.serve`；Node 实现用 `node:http` + `ws`。`admin-auth.ts` 改为使用 `ctx.ip`。

### CR-RUN-07 — 包入口/构建/engines

**当前**:

```json
{
  "main": "./src/index.ts",
  "types": "./src/index.ts"
}
```

```json
// tsconfig
"types": ["bun"]
```

**目标**:
- `main`/`exports` 指向 `dist`（或明确只支持源码运行）。
- `engines`: `node >= 26`、`bun >= 1.4`。
- `tsconfig.node.json` 不包含 `types: ["bun"]`；Bun 适配层单独配置。
- Node 产物：`bun build --target node` 或 esbuild；`@opentui/*` 等原生模块 external。
- CI：Bun 全量；Node 26 smoke。

---

## 7. 多 Provider

### CR-PRO-01 — 5 处硬编码 `createDeepSeek`

**位置**:
- `core/pipelines/conversation/elements/stream-llm.ts:6,245`
- `core/pipelines/shared/llm.ts:2,20`
- `core/decision/choose.ts:2,87`
- `core/pipelines/prediction/elements/predict-intent.ts:6,78`
- `services/agents-compiler.ts:6,156`

**当前**:

```ts
const provider = createDeepSeek({ apiKey: this.#apiKey, baseURL: this.#baseUrl });
const model = provider(this.#model);
```

**问题**: `RuntimeService.getResolvedModel()` 返回 `provider`，但没有任何工厂消费它；OpenAI/Anthropic 配置会走 DeepSeek SDK。

### CR-PRO-02 — Provider 工厂与配置协议

**目标**:

```ts
// config
export type ProviderProtocol = "deepseek" | "openai" | "anthropic" | "openai-compatible";

// factory
export function createLanguageModel(model: ResolvedModel): LanguageModel {
  switch (model.protocol) {
    case "deepseek": return createDeepSeek({ apiKey: model.apiKey, baseURL: model.baseUrl })(model.model);
    case "openai": return createOpenAI({ apiKey: model.apiKey, baseURL: model.baseUrl })(model.model);
    case "anthropic": return createAnthropic({ apiKey: model.apiKey, baseURL: model.baseUrl })(model.model);
    case "openai-compatible": return createOpenAICompatible({ name: model.provider, apiKey: model.apiKey, baseURL: model.baseUrl })(model.model);
  }
}
```

配置增加可选 `providers[id].protocol`，默认按 id 推断，兼容旧配置。

### CR-PRO-03 — Prompt 语言默认 DeepSeek/中文

**当前**: `shared/prompts/index.ts`:

```ts
export function resolvePrompt(key: PromptKey, providerModel?: string): string {
  const [provider = "deepseek", model = "deepseek-v4-pro"] = (providerModel ?? "deepseek/deepseek-v4-pro").split("/");
  return getRegistry().resolve(key, provider, model);
}
```

多数调用不传 `providerModel`（`shared/llm.ts:24`、`choose.ts:88`、`compress-summarize.ts`），最终总是中文 DeepSeek 提示词。

**目标**: 所有 LLM 调用传 `provider/model`；`LANGUAGE_MAP` 补 `openai/anthropic/openai-compatible`；非 DeepSeek 默认 `en`。

### CR-PRO-04 — Provider Options 只支持 DeepSeek

**当前**:

```ts
export function deepSeekProviderOptions(thinking?: string) {
  return { deepseek: { thinking: { type: thinking === "adaptive" ? "enabled" : thinking ?? "disabled" } } };
}
```

**目标**: `ProviderOptionsStrategy`：

```ts
type ProviderOptionsStrategy = {
  build(thinking?: string): Record<string, unknown>;
};
// deepseek -> { deepseek: { thinking } }
// openai -> { openai: { reasoningEffort } }
// anthropic -> { anthropic: { thinking: { type, budgetTokens } } }
```

### CR-PRO-05 — AgentsCompiler 忽略 Provider 配置

**当前**: `services/agents-compiler.ts:155-160` 固定 `createDeepSeek` + `deepseek-v4-flash`，只读 `providers.deepseek.thinking`。

**目标**: 注入 `getResolvedModel("fast")` 或 `ModelProvider`；使用同一工厂与 provider options。

### CR-PRO-06 — API Key 跨 Provider 回退

**位置**: `services/runtime-service.ts:94-97`、`main.ts:159`

**当前**:

```ts
const apiKey = (apiKeyEnv ? process.env[apiKeyEnv] : undefined) ?? (type === "llm" ? this.#apiKey : "");
```

`this.#apiKey` 来自 `DEEPSEEK_API_KEY ?? OPENAI_API_KEY`；配置缺失时可能把不相关的 Key 发给另一个 Provider。

**目标**: 只使用配置的 `apiKeyEnv`；缺失时明确报错或返回空并阻止启动，不做跨 Provider 回退。

---

## 8. 结构重构目标

### CR-STR-01 — `stream-llm.ts`（1227 行）

**目标文件**:
- `stream-loop.ts`：循环与 `StepOutcome`
- `tool-runtime.ts`：治理、执行、记录
- `stream-reporting.ts`：transport/usage/trace
- `stream-llm.ts`：Element 编排，<300 行

**验收**: 行为测试不变；内置/MCP 工具路径共用；无 `#toolResults` 侧信道。

### CR-STR-02 — `server.ts`（793 行）

**目标文件**: `bootstrap.ts`、`pipeline-factory.ts`、`task-lifecycle.ts`、`http-router.ts`、`mcp-lifecycle.ts`。

### CR-STR-03 — `memory-service.ts`（550 行）

`memory-store.ts`（DB/迁移/行映射）、`memory-query.ts`（搜索/排名胶水）、`memory-graph.ts`（traverse/link）、`memory-service.ts` 门面。

### CR-STR-04 — `context-service.ts`（552 行）

`bucket-store.ts`、`snapshot-manager.ts`、`context-codec.ts`；修正 `ownerMatches` 参数顺序不对称。

### CR-STR-05 — `persistence-service.ts`（514 行）

`checkpoint-store.ts`（generation/fsync/atomic）、`history-store.ts`（archive/search）；`restore()` 不做写操作或显式 repair-on-start。

### CR-STR-06 — `ClientManager`（272 行）

`ProcessSupervisor` 状态机；一个重启/健康检查调度源。

### CR-STR-07 — `check-follow-up.ts` / `compress-finalize.ts`

- `check-follow-up`：纯函数 `decideContinuation(input, todos)` + `arbitrate()`。
- `compress-finalize`：`planCompressCommit` / `applyCompressCommit` / `resumeAfterCompress`。

### CR-STR-08 — TUI `chat.ts`（296 行）/ `useChat.ts`（175 行）

拆 message/stream/tools/telemetry slice；`TuiConnection` 适配器；`useChat` 只做组合。

### CR-STR-09 — TUI 面板

`Sidebar` 219 行 5 个导出、`RuntimeSidebar` 208 行 5 段、`SettingsModal` 224 行、`InputBar` 256 行。拆 section 组件 + `ApiClient` + `useDoublePress`。

### CR-STR-10 — `WizardApp` reducer

`useReducer` + 路由联合类型；删除只写不读的 `step`；`commit()` 改为 async。

### CR-STR-11 — `tui-kit` 抽取

见 CR-DUP-01/02/05；新包 `@atom-neo/tui-kit`（S5 规划）。

---

## 9. 文件总表

| 文件 | 行数 | 关联 ID | 动作 |
|---|---:|---|---|
| `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts` | 1227 | CR-ARCH-12, CR-DUP-11, CR-STR-01, CR-PRO-01 | 拆分/Provider |
| `src/packages/core/src/server.ts` | 793 | CR-COR-02/06, CR-ARCH-13, CR-STR-02, CR-RUN-06 | 拆分/生命周期/HTTP |
| `src/packages/core/src/context/context-service.ts` | 552 | CR-STR-04, CR-NAM-10 | 拆分/注释 |
| `src/services/memory-service.ts` | 550 | CR-COR-03, CR-STR-03, CR-RUN-05 | 生命周期/拆分/SQLite |
| `src/packages/core/src/session/persistence-service.ts` | 514 | CR-DUP-05, CR-STR-05 | 原子写/拆分 |
| `src/packages/config-tui/src/wizard-logic.ts` | 441 | CR-COR-01, CR-DUP-03/04 | 写盘/配置契约 |
| `src/bootstrap/backup.ts` | 336 | CR-DUP-04/05 | env/原子写 |
| `src/packages/core/src/task-engine.ts` | 281 | CR-ARCH-02/08 | 注入/循环 |
| `src/packages/gateway/src/client-manager/index.ts` | 272 | CR-ARCH-09, CR-RUN-02 | Supervisor |
| `src/packages/core/src/tools/builtin/shell.ts` | 278 | CR-RUN-02 | child_process |
| `src/packages/core/src/tools/schedule-service.ts` | 266 | CR-RUN-04 | croner |
| `src/packages/core/src/tools/builtin/fs.ts` | 266 | CR-RUN-03 | fs.glob |
| `src/packages/tui/src/client/ws-client.ts` | 260 | CR-ARCH-15, CR-STR-08 | 协议路由 |
| `src/packages/config-tui/src/components/WizardApp.tsx` | 262 | CR-ARCH-11, CR-STR-10 | reducer |
| `src/packages/tui/src/components/InputBar.tsx` | 256 | CR-STR-09 | 拆分 |
| `src/packages/tui/src/stores/chat.ts` | 296 | CR-STR-08 | slice |
| `src/packages/tui/src/hooks/useChat.ts` | 175 | CR-STR-08 | 连接适配器 |
| `src/packages/tui/src/components/App.tsx` | 212 | CR-ARCH-05/10 | Theme 移出/Modal 表 |
| `src/packages/tui/src/components/Sidebar.tsx` | 219 | CR-STR-09 | 拆分 |
| `src/packages/tui/src/components/RuntimeSidebar.tsx` | 208 | CR-STR-09 | 拆分 |
| `src/packages/tui/src/components/SettingsModal.tsx` | 224 | CR-STR-09 | Hook/API client |
| `src/packages/core/src/pipelines/shared/llm.ts` | 39 | CR-PRO-01/03 | Provider 工厂 |
| `src/packages/core/src/decision/choose.ts` | ~110 | CR-PRO-01/03/04 | Provider 工厂 |
| `src/packages/core/src/pipelines/prediction/elements/predict-intent.ts` | ~110 | CR-PRO-01 | Provider 工厂 |
| `src/services/agents-compiler.ts` | ~180 | CR-PRO-05 | 注入模型 |
| `src/packages/shared/src/constants/events.ts` | 87 | CR-DUP-08 | 单一事件源 |
| `src/packages/shared/src/types/pipeline.ts` | ~145 | CR-DUP-08 | 类型派生 |
| `src/packages/shared/src/protocol.ts` | ~160 | CR-DUP-08, CR-DOC-08 | 删除/派生 |
| `pages/*.tsx` | 6493 | CR-DUP-09, CR-DOC-01 | 删除 |
| `server.tsx` | ~280 | CR-DOC-01 | 删除/替换 |
| `components/*` | — | CR-DOC-01 | 删除 |
| `shared.ts` | — | CR-DOC-01 | 删除 |
| `src/packages/tui-kit/src/theme.tsx` | ~150 | CR-DUP-02 | 已移入 tui-kit（S5） |
| config-tui 旧 `theme.tsx` | ~100 | CR-DUP-02 | 已删除（S5） |
| `src/packages/tui/src/components/modal/*` | ~300 | CR-DUP-01, CR-ARCH-05 | 移入 tui-kit |
| `src/packages/config-tui/src/modal/*` | ~250 | CR-DUP-01 | 删除副本 |

> 完整清单以仓库 `git ls-files` 为准；本表只列高影响文件。

---

## 10. 禁区 / 暂不修改

以下内容在本次整改中**保持原样**：

1. 未实现的 5 个兼容 Element：
   - `load-system-prompt.ts`
   - `fetch-agents-prompt.ts`
   - `format-system-messages.ts`
   - `format-user-messages.ts`
   - `inject-skill-context.ts`
2. `pipelines/follow-up/` 及其 Element。
3. `PipelineRunner`、`PipelineManager`、`PipelineRecorder`、`PipelinePlayer`：暂不删除，不接线；只修正文档“已实现”的声明。
4. `CommandPalette`、`useCopied`：暂不删除。
5. 不对 `node:fs/path/crypto` 造抽象层。
6. 不把全部 `bun:test` 迁移到 Node；Node 使用独立 smoke suite。
7. 不引入 DI 容器；继续构造器/显式对象注入。

---

## 11. 验收命令

```bash
# 类型
bun run typecheck

# 全量测试
bun test

# 目标测试（示例）
bun test src/packages/core/src/session
bun test src/packages/config-tui/src/wizard-logic.test.ts

# Bun 运行
bun run src/main.ts --mode core --sandbox ./sandbox

# Node 运行（阶段 9+）
node dist/node/main.js --mode core --sandbox ./sandbox

# 文档
bun run docs
node dist/node/docs-server.js   # 阶段 4 后

# 运行时残留检查
rg -n 'Bun\.' src --glob '!**/dist/**' --glob '!**/node_modules/**'
# 期望：仅剩 server/WebSocket 适配层（阶段 9 后应为 0）

# 文件头检查（阶段 3 后）
bun run scripts/check-file-headers.ts
```

---

## 12. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-10 | 初始审查快照；锁定 ID、代码片段与验收标准 |
| 2026-11-10 | S0/S1 实施完成：P0 CR-COR-01..11；typecheck/build 5/5，测试 1453 pass / 21 skip / 0 fail；版本 1.22.1 |
| 2026-11-10 | S2 实施完成（非 Server）：CR-RUN-01..05；`Bun.write/env/argv/sleep/stringWidth/main/spawn/Glob/cron`、`bun:sqlite` 全部迁移；新增 `string-width`、`croner`；源码测试 848 pass / 21 skip / 0 fail（`bun test` 含既有 dist 副本时 1492 pass）；版本 1.22.2 |
| 2026-11-11 | S3 实施完成：共享配置契约、env/原子写/helpers、Skill/MemoryKind/Todo 类型收口；`config-tui`/`gateway` 使用 shared；删除顶层 `theme`；测试 1600 pass / 21 skip / 0 fail（源码 904）；版本 1.22.3；文件命名/文件头延后 S3b |
| 2026-11-11 | S4 实施完成：删除 JSX 文档站，新增 `marked` Markdown → HTML 服务；records 归档；Context/启动/Skill 文档收敛；`docs:check`/`docs:typecheck` 通过；Bun/Node smoke 通过；测试 1612 pass / 21 skip / 0 fail（源码 916）；版本 1.22.5 |
| 2026-11-11 | S5 实施完成：新增 `@atom-neo/tui-kit` 统一主题/Modal/FieldInput/SelectableRow；Modal 状态与键盘修复；`tui`/`config-tui` 删除副本；typecheck/build 6/6，测试 1624 pass / 21 skip / 0 fail（源码 922）；版本 1.22.6 |
| 2026-11-11 | S6 实施完成：`EVENTS` 单一事件目录；`BusEvents`/`WsMessages`/事件映射/协议联合派生；`conversation.chain/idle` envelope 修复；新增 `TaskSubmissionService` 统一 HTTP/WS 提交；TUI 改为 typed `ServerEvent` 路由；`protocol.md`/`pipeline-dev.md` 对齐；typecheck/build 6/6，`docs:check`/`docs:typecheck` 通过；测试 1672 pass / 21 skip / 0 fail（源码 946）；版本 1.22.7 |
| 2026-11-11 | S7 实施完成：`protocol` 配置与 Provider 工厂、Provider options 策略、provider-aware Prompt 语言、AgentsCompiler 模型解析、API Key 隔离；四 Provider fake 测试；typecheck/build 6/6，`docs:check`/`docs:typecheck` 通过；测试 1701 pass / 21 skip / 0 fail（源码 961）；版本 1.22.8 |
| 2026-11-11 | S8 实施完成：`server.ts` 拆为 `bootstrap`/`pipeline-factory`/`task-lifecycle`/`http-router`/`mcp-lifecycle`；`startCore` 853→102 行，行为与路由/回滚/MCP 停止顺序不变；新增路由与 Task.Completed 回滚测试；typecheck/build 6/6，`docs:check`/`docs:typecheck` 通过；测试 1717 pass / 21 skip / 0 fail（源码 969）；版本 1.22.9 |
| 2026-11-11 | S9 专项文档完成：拆分 S9-A..E，新增问题清单、关系图与实施计划三份文档；未改动 `src/`，S9-A..E 待实施 |
| 2026-11-11 | S9-A 实施完成：新增 `shared/src/http` 契约/检测；admin 鉴权改用 `ctx.ip`；删除 `RouterServer`，router 拆为 `fetch`/`upgrade`；WS 改用 `WebSocketPeer` 并归一消息；`ws` on Bun spike 通过（101/text/binary/close/50 连接/remoteAddress，`EXIT=0`）；typecheck/build 6/6，源码 975 pass / 21 skip / 0 fail，全量 1729 pass（dist 重建后） |
| 2026-11-11 | S9-B..E 实施完成（S9 完成）：Bun/Node 双 adapter、`ATOM_HTTP_RUNTIME` 运行时选择、Node 入口与 Gateway logger 注入；S9-E 新增 Node fake conversation smoke（11 项 PASS）与 Bun→Node cross-runtime smoke（7 项 PASS），fixture `gateway-client.ts` 清理为 `node:http`；残留检查仅 Bun adapter 保留 `Bun.serve`/`Bun.Server`/`requestIP`；typecheck/build 6/6，源码 1001 pass / 21 skip / 0 fail，全量 1781 pass；版本 1.22.10；spike 通过但保留双 adapter，S10 再评估统一 |
| 2026-11-11 | Node 支持下限调整为 26：`engines.node` 改为 `>=26`，入口统一使用 `import.meta.main`；版本 1.22.11 |
| 2026-11-11 | S10-A 实施完成（仅构建/类型检查边界）：根 `tsconfig.json` 保持共享基础，新增 `tsconfig.node.json`/`typecheck:node`（`types: ["node"]`，排除测试、`dist`、Bun HTTP adapter；`scripts/types/` 精确 shim 隔离 `@types/bun`）；新增 `build:node` → `dist/node/main.js`（`@opentui/*` external，`ws` bundle）；TUI/Config-TUI 改用 `ensureBunRuntimePluginSupport()`，Node 不再执行 Bun-only runtime plugin；新增 `scripts/node-smoke/build.ts`；Bun workspace typecheck/compile 不变；S10-B 的完整 smoke/CI/发布未做 |
