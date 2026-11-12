# Atom Neo Code Review — S12 Giant Files / TUI Structure — 2026-11-12

> **Baseline**: `code-review/2026-11-10` @ `e3b51f5` (v1.23.0, S11 complete)
> **Scope**: CR-STR-01..11、CR-ARCH-10/11/12、CR-DUP-11/12 中尚未收口的巨型文件与 TUI 结构问题
> **Status**: **S12 已完成（v1.24.1，2026-11-12）**。A–H 全部实施并通过 H1–H4 验收；本文保留实施前问题与目标边界，最终行数、测试矩阵与行数目标见第 5/6/7 节。
> **Related**:
> - [code-review-s12-graph-2026-11-12.md](./code-review-s12-graph-2026-11-12.md)
> - [code-review-s12-plan-2026-11-12.md](./code-review-s12-plan-2026-11-12.md)
> - [code-review-plan-2026-11-10.md](./code-review-plan-2026-11-10.md)
> - [code-review-2026-11-10.md](./code-review-2026-11-10.md)

---

## 0. 使用说明

1. 本文记录 S12 的**结构问题、实施前代码、目标模块边界与行为不变量**；任务拆分、工时、测试矩阵与回滚见 [S12 实施计划](./code-review-s12-plan-2026-11-12.md)。S12 已完成，最终数字见 5.1、6.4、7.3。
2. 行号与行数以 `e3b51f5` 为准，后续会漂移；定位优先搜索类名、函数名、事件名与注释锚点。
3. `当前` 是基线代码；`目标` 是方向性契约，不要求逐字照抄。
4. S12 是**纯结构重构**：不改产品行为、不改 DB schema、不改文件格式、不改事件名/HTTP/WS 路由、不改 Task/Event 契约。
5. CR-STR-02（`server.ts`）已由 S8 关闭；CR-STR-11（`tui-kit`）已由 S5 关闭；CR-STR-06 已由 S11-E 大幅缩小，仅剩 `ProcessSupervisor` 行数收尾。本文只记录残余工作。
6. 所有新文件路径在正文中使用 `packages/...` 形式（省略仓库根 `src/`），避免 `docs:check` 把规划文件误判为断链；已存在文件仍写完整 `src/...`。

### 稳定 ID

| 前缀 | 含义 |
|---|---|
| `S12-A1..A16` | `stream-llm` 行为快照与模块提取 |
| `S12-B1..B7` | `memory-service` 拆分 |
| `S12-C1..C9` | `context-service` 拆分 |
| `S12-D1..D8` | `persistence-service` 拆分 |
| `S12-E1..E18` | Core 纯函数、ProcessSupervisor 残余、工具执行与消息投影 |
| `S12-F1..F10` | TUI chat store / useChat / ChatView |
| `S12-G1..G25` | TUI 面板 / App Modal / Wizard reducer |
| `S12-H1..H4` | 行数与行为验收 |

### 基线计数（2026-11-12 实测）

```bash
wc -l \
  src/packages/core/src/pipelines/conversation/elements/stream-llm.ts \
  src/services/memory-service.ts \
  src/packages/core/src/context/context-service.ts \
  src/packages/core/src/session/persistence-service.ts \
  src/packages/gateway/src/client-manager/process-supervisor.ts \
  src/packages/config-tui/src/wizard-logic.ts \
  src/packages/tui/src/stores/chat.ts \
  src/packages/tui/src/hooks/useChat.ts
```

| 文件 | 行数 | 主要 CR |
|---|---:|---|
| `src/packages/core/src/pipelines/conversation/elements/stream-llm.ts` | **1240** | CR-STR-01, CR-ARCH-12, CR-DUP-11 |
| `src/services/memory-service.ts` | **565** | CR-STR-03 |
| `src/packages/core/src/context/context-service.ts` | **552** | CR-STR-04 |
| `src/packages/core/src/session/persistence-service.ts` | **515** | CR-STR-05 |
| `src/packages/gateway/src/client-manager/process-supervisor.ts` | **411** | CR-STR-06（残余） |
| `src/packages/config-tui/src/wizard-logic.ts` | **391** | CR-STR-10 |
| `src/packages/tui/src/stores/chat.ts` | **296** | CR-STR-08 |
| `src/packages/tui/src/components/InputBar.tsx` | **256** | CR-STR-09 |
| `src/packages/config-tui/src/components/WizardApp.tsx` | **262** | CR-ARCH-11, CR-STR-10 |
| `src/packages/tui/src/components/SettingsModal.tsx` | **221** | CR-STR-09 |
| `src/packages/tui/src/components/Sidebar.tsx` | **219** | CR-STR-09 |
| `src/packages/tui/src/components/RuntimeSidebar.tsx` | **208** | CR-STR-09 |
| `src/packages/tui/src/components/App.tsx` | **205** | CR-ARCH-10 |
| `src/packages/core/src/pipelines/context-compress/elements/compress-finalize.ts` | **247** | CR-STR-07 |
| `src/packages/core/src/pipelines/conversation/elements/check-follow-up.ts` | **188** | CR-STR-07 |
| `src/packages/tui/src/hooks/useChat.ts` | **175** | CR-STR-08 |
| `src/packages/tui/src/components/ChatView.tsx` | **86** | CR-STR-08 |
| `src/packages/gateway/src/client-manager/index.ts` | **106** | CR-STR-06（已缩小） |

> 说明：`chat.ts` / `ChatView.tsx` 已低于 300 行，但它们的职责仍混合；S12 仍按 CR-STR-08 做**行为对齐的职责拆分**，不是为凑行数。

---

## 1. 结论与范围

### 结论

S11 之后，构造/全局状态已经收口，巨型文件可以安全拆分。S12 的问题不是“逻辑错误”，而是：

1. **单文件/单函数承担多个生命周期**：`stream-llm` 同时做模型循环、工具治理、事件上报、Context 快照、记录与结果投影。
2. **服务类混合 I/O、查询、图遍历与生命周期**：`memory-service`、`context-service`、`persistence-service`。
3. **TUI 状态/视图/连接耦合**：`chat.ts`、`useChat.ts` 与 `App.tsx` 把事件路由、状态变更、Modal 分支放在同一层。
4. **重复的投影/执行路径**：`stream-llm` 内置/MCP 工具各一套治理/执行/记录；消息投影有 4 套形态。
5. **验收不可量化**：没有行数/函数长度 guard，拆分后容易回涨。

S12 必须拆成多条**可独立提交、可独立回滚**的小任务；不允许“一次性重写 `stream-llm`”。

### 范围内

- `stream-llm` → stream loop / step / tool runtime / reporting / governance / context / finalize。
- `memory-service` → store / query / graph / types / facade。
- `context-service` → bucket store / snapshot manager / codec / types / facade。
- `persistence-service` → checkpoint store / history store / format / durable IO / facade。
- `ProcessSupervisor` 残余行数拆分（状态机语义不动）。
- `check-follow-up` / `compress-finalize` 纯函数化。
- 工具执行与消息投影统一（CR-DUP-11/12 的残余部分）。
- TUI `chat` store / `useChat` / `ChatView` 拆分。
- TUI `Sidebar` / `RuntimeSidebar` / `SettingsModal` / `InputBar` / `App` Modal 配置表。
- `WizardApp` reducer / 路由守卫 / `wizard-logic` 拆分。
- 行数与函数长度 guard、行为快照、文档与 README 同步。

### 范围外（明确不做）

- 任何新功能、UI 改版、交互变更。
- DB schema、FTS5 配置、Context `schemaVersion`、Session checkpoint 文件格式。
- 事件名、事件 payload、HTTP/WS 路由、Task/Event 契约。
- `server.ts`（CR-STR-02 已由 S8 关闭）。
- `tui-kit` 抽取（CR-STR-11 已由 S5 关闭）；S12 只消费 `tui-kit`，不改主题/Modal 契约。
- 未实现 Element、`follow-up`、Replay、`PipelineRunner` / `PipelineManager` / `PipelineRecorder`（禁区）。
- 全量 `any` 清理；只清理拆分过程中新文件需要的类型边界。
- 把全仓库所有文件压到 300 行：S12 只对**78 个目标文件**负责；当前目标无例外，非目标文件不在承诺内。
- 删除重复的 Provider/Prompt/DI 抽象；S7/S11 已稳定。

---

## 2. CR 现状清单

| ID | 现状 | 当前实现 | S12 目标 |
|---|---|---|---|
| CR-STR-01 | **已关闭（S12）** | `stream-llm.ts` 1240 行；`doProcess` 约 700 行 | stream loop/step/tool/reporting/context/finalize 分层；Element ≤300 行，主函数 ≤100 行 |
| CR-STR-02 | **已关闭（S8）** | `src/packages/core/src/server.ts` 108 行；`bootstrap`/`pipeline-factory`/`task-lifecycle`/`http-router`/`mcp-lifecycle` 已拆出 | 不再改；S12 只做防回归（不重新聚合） |
| CR-STR-03 | **已关闭（S12）** | `memory-service.ts` 565 行；DB/迁移/搜索/图/生命周期同文件 | `memory-store` + `memory-query` + `memory-graph` + `memory-types` + facade |
| CR-STR-04 | **已关闭（S12）** | `context-service.ts` 552 行；Bucket/Snapshot/生命周期/持久化同文件 | `bucket-store` + `snapshot-manager` + `context-codec` + `context-types` + facade |
| CR-STR-05 | **已关闭（S12）** | `persistence-service.ts` 515 行；格式/checkpoint/history/durable IO 同文件 | `session-format` + `durable-fs` + `checkpoint-store` + `history-store` + facade |
| CR-STR-06 | **已关闭（S12）** | `ClientManager` 106 行（facade）；`ProcessSupervisor` 411 行 | 命令构造/终止流程拆出；`ProcessSupervisor` 277 行；状态机/重启/健康语义不变 |
| CR-STR-07 | **已关闭（S12）** | `check-follow-up.ts` 188 行；规则/证据/LLM 仲裁同文件；`compress-finalize.ts` 247 行；写入/checkpoint/resume 同文件 | 规则、证据、仲裁、提交、恢复拆为纯函数/小模块 |
| CR-STR-08 | **已关闭（S12）** | `chat.ts` 296 行；`useChat.ts` 175 行；`ChatView.tsx` 86 行 | store slices + `chat-connection` + `useChat` 组合 + view model |
| CR-STR-09 | **已关闭（S12）** | `Sidebar` 219 行 5 个导出；`RuntimeSidebar` 208 行 5 段；`SettingsModal` 221 行；`InputBar` 256 行 | section 组件 + `settings-model` / `use-settings-config` + input hooks |
| CR-STR-10 | **已关闭（S12）** | `WizardApp.tsx` 262 行，10 处 `!quitConfirm && view === ...`；`wizard-logic.ts` 391 行；`WizardState.step` 只写不读 | reducer + 判别联合路由；`wizard-logic` 拆 state/edit/commit + barrel |
| CR-STR-11 | **已关闭（S5）** | `@atom-neo/tui-kit` 已存在，主题/Modal/FieldInput 已收敛 | 不再改；S12 只从 `tui-kit` 导入 |
| CR-ARCH-10 | **已关闭（S12）** | `App.tsx` Modal 7 个三元表达式；title/width/height/actions/defaultAction/onAction/content 分别分支 | `ModalSpec` 配置表 + `AppModal` 组件 |
| CR-ARCH-11 | **已关闭（S12）** | `WizardApp.tsx` 10 处 `!quitConfirm && view === "..."` | `useReducer` + 判别联合 view + 单一 route guard |
| CR-ARCH-12 | **已关闭（S12，与 CR-STR-01 同一工作）** | `stream-llm.ts` `doProcess` God Function | 同 CR-STR-01；不再单列实施 |
| CR-DUP-11 | **已关闭（S12）** | 内置/MCP 工具各一套治理/执行/记录；`stringifyToolOutput` 在 `stream-llm.ts` 与 `tool-loop.ts` 各一份；`#toolResults` 侧信道 | 统一 `executeGovernedTool()`；状态显式返回；共用 `stringifyToolOutput` |
| CR-DUP-12 | **已关闭（S12）** | `appendCurrentUserMessage` 变异输入；reasoning 保留策略分散；`isPromptEligibleMessage` 已存在但映射逻辑仍分散 | 纯函数投影 + 单一 reasoning 策略 + 复用 `message-policy` |

### 已关闭/缩减项说明

- **CR-STR-02**：S8 已把 `startCore` 拆为 5 个模块，`server.ts` 108 行。S12 不再触碰，避免“为行数再拆一层”。
- **CR-STR-11**：S5 已创建 `@atom-neo/tui-kit`，主题与 Modal 只有一份。S12 的 TUI 任务只允许**移动组件内部结构**，不改 `tui-kit` 的导出与行为。
- **CR-STR-06**：S11-E 已把 `ClientManager` 变成 facade（106 行），并发/重启/健康状态机都在 `ProcessSupervisor`。残余只是 411 → ≤300 的文件行数拆分，不重新设计状态机。

---

## 3. 当前结构（节选）

### 3.1 `stream-llm.ts`

```ts
export class StreamLLMElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  // 20+ 私有字段：provider/model/tools/session/context/toolRecords/...
  #toolResults = new Map<string, ToolExecutionStatus[]>();

  constructor(params) { /* 构建内置工具 + MCP 工具 */ }

  async doProcess(input): Promise<ConversationFlowState> {
    // 1. TODO / continuation / trace 初始化
    // 2. system + user message 投影
    // 3. ToolCallLedger / MCP wrapper / schema-only tools
    // 4. while modelStep: beforeCall → streamText → chunk 解析
    //    → usage/commit snapshot → reporting → tool batch validate
    //    → 内置/MCP 工具执行 → context injection → tool record
    //    → projectToolMessages → governance → 退出原因
    // 5. seal tool group / token overflow / final result
  }
}

function stringifyToolOutput(...)         // 与 tool-loop.ts 重复
function beginGovernedToolCall(...)       // 内置/MCP 共用治理入口
function finishGovernedToolCall(...)
function buildAllAiTools(...)             // 内置工具包装
export function wrapMCPAiTools(...)       // MCP 工具包装
function resolveTimeout(...)
function toIntentRequest(...)
```

### 3.2 `memory-service.ts`

```ts
export class MemoryService extends BaseService {
  #db: SqliteDatabase | null;
  #dbPath; #legacyNodesPath; #now;

  async search(...)        // FTS5 + short-term + ranking
  traverse(...)            // BFS + edges
  save(...) / link(...) / forget(...) / retain(...) / recordRead(...)
  protected async onStart() / onStop()
  #initDb()                // DDL + migration + FTS triggers
  #migrateLegacyContent()
  #loadNode() / #memoryQuality() / #isSuperseded() / #recordRetrievals()
}
```

### 3.3 `context-service.ts`

```ts
export class ContextService {
  #buckets: Map<string, MutableBucket>;
  #snapshots: Map<string, MutableSnapshotState>;
  #bucketLeases: Map<string, number>;

  start() / stop()
  put() / remove() / get()
  createSnapshot() / commitSnapshot() / releaseSnapshot() / inspectSnapshot()
  expireScope() / sweepExpired() / disposeExpired()
  exportSessionState() / restoreSessionState()
  #expireBuckets() / #releaseLeases() / #onTopicChanged() / #onTaskEnded()
}
```

### 3.4 `persistence-service.ts`

```ts
export class SessionPersistenceService {
  readonly toolRecords = new ToolRecordStore();
  checkpoint(...)   // generation write + publish + cleanup
  restore(...)      // read session/context/messages/tool-records
  archiveMessages(...) / searchHistory(...) / readHistory(...)
  #writeGeneration() / #publishGeneration() / #resolveCurrentGeneration()
  #writeDurable() / #writeAtomic() / #fsyncDirectory()
}
```

### 3.5 TUI

```ts
// chat.ts
export const useChatStore = create<ChatState>((set, get) => ({
  messages, toolGroupId, activeAssistantId, busy, showPreparing,
  // + stream counters / todo / rounds / MCP / decisions
  handleDelta, handleReason, handleToolEvent, handleToolGroupComplete,
  setBusy, updateMCPConnected, prepareForSend, ...
}));

// useChat.ts
useEffect(() => {
  const client = new TuiClient(...);
  client.onSnapshot(...); client.onTelemetry(...); client.onDelta(...);
  client.onTool(...); client.onBusyChange(...); ...
}, [url, sessionId]);

// App.tsx
{activeModal && activeModal.kind !== "settings" && (
  <Modal title={activeModal.kind === ... ? ... : ...} ...>
    {activeModal.kind === "tool-details" ? ... : ...}
  </Modal>
)}
```

---

## 4. 目标模块边界

### 4.1 `stream-llm` — 循环 / 工具运行时 / 上报 / 治理

目标目录：

```text
src/packages/core/src/pipelines/conversation/elements/
  stream-llm.ts                     # Element shell：字段、构造、doProcess 编排
  stream/
    README.md
    types.ts                        # StepOutcome、ToolExecutionStatus、循环结果类型
    stream-model-input.ts           # resolveModelInput/cache/token/effect 投影
    stream-step.ts                  # 单次 streamText + chunk 消费 + usage
    stream-context.ts               # refreshStepContext、snapshot、tool context 注入
    stream-reporting.ts             # transport/usage/trace/step 事件
    stream-loop.ts                  # while 循环、退出原因、governance 驱动
    stream-finalize.ts              # token overflow、结果投影、intents
    tool-batch.ts                   # batch 校验、逐调用记录、projectToolMessages
    tool-runtime.ts                 # executeGovernedTool + 内置工具适配
    tool-runtime-mcp.ts             # MCP 工具适配 + metadata
    tool-governance-runtime.ts      # begin/finish governed call
    tool-result-status.ts           # 执行状态队列 + stringify
```

边界规则：

- `stream-llm.ts` 只持有 Element 字段和 `doProcess`；不直接 `streamText`、不直接执行工具。
- `stream-loop.ts` 负责循环与退出原因；不构造 Element，不写 Context DDL。
- `stream-step.ts` 只负责“一次模型 step”：`beforeCall`、`streamText`、chunk 解析、usage、finishReason。返回 `StepOutcome`，不执行工具。
- `tool-runtime.ts` 只负责“执行一个已通过治理的工具调用”；返回 `{ content, metadata, record, startedAt, durationMs }`，不再通过 `#toolResults` 侧信道。
- `stream-reporting.ts` 只做事件 payload 组装；不决定业务分支。
- `stream-context.ts` 只做 Snapshot 刷新、commit/release、Tool Context 注入；不决定 tool 是否执行。
- `stream-finalize.ts` 只做最终结果字段投影；不做循环控制。

### 4.2 `memory-service` — query / ranking / storage

目标目录：

```text
src/services/
  memory-service.ts                  # BaseService facade：生命周期 + 公共 API 委托
  memory/
    README.md
    memory-types.ts                  # MemoryNode / SaveOptions / TraversalNode
    memory-store.ts                  # DB open、DDL、迁移、行映射、FTS 维护
    memory-query.ts                  # search + short-term + rank/score + retrieval 记录
    memory-graph.ts                  # traverse / link / countRelated / edges
```

边界规则：

- `memory-store` 不计算业务分数；只提供 `findById` / `allRows` / `insertOrUpdate` / `delete` / `edgesOf` / `transaction`。
- `memory-query` 只依赖 store 与 `memory-ranking`；不直接 open/close DB。
- `memory-graph` 只依赖 store；不做 FTS。
- `memory-service` 保持当前公共方法签名与错误文案；`MemoryNode` / `MemorySaveOptions` / `MemoryTraversalNode` 从 facade re-export，避免外部 import 变化。
- DB schema、FTS5 trigram、trigger、edge 去重 SQL 必须逐字保留（允许格式化，不允许语义变化）。

### 4.3 `context-service` — store / snapshot / compaction

目标目录：

```text
src/packages/core/src/context/
  README.md
  context-service.ts                 # facade：生命周期、bus 订阅、export/restore
  context-types.ts                   # MutableBucket / SnapshotRecord / Persisted*
  context-codec.ts                   # bucketId/contextId/ownerMatches/pickOwner/freeze
  bucket-store.ts                    # bucket CRUD、expire、dispose、inspect
  snapshot-manager.ts                # snapshot create/commit/release、lease、TTL
```

边界规则：

- `BucketStore` 是 bucket 的唯一 owner；`SnapshotManager` 不直接改 bucket entry，只通过 `BucketStore` 的窄方法。
- `context-codec` 只做纯函数；不持有状态。
- `ownerMatches` 的匹配方向必须显式命名（`filterMatchesOwner`）并有双向测试；**不改变当前语义**。
- Snapshot 的 `refs` / `receipts` / `manifest` / `prefixHash` / `inputBudget` 字段逐字保留；`exportSessionState` 输出 JSON 不变。
- `ContextService` 公共方法签名、事件订阅顺序、`disposeExpired` 时机不变。

### 4.4 `persistence-service` — archive / checkpoint

目标目录：

```text
src/packages/core/src/session/
  README.md
  persistence-service.ts             # facade：checkpoint/restore/history/remove
  session-format.ts                  # manifest 类型、JSONL 编解码、路径常量
  durable-fs.ts                      # writeDurable/fsyncDirectory/writeAtomic
  checkpoint-store.ts                # generation 写入/发布/解析/清理
  history-store.ts                   # archive 写入/索引/搜索/读取
```

边界规则：

- `checkpoint-store` 负责 generation 目录、`current` 软链、兼容软链、旧 generation 清理；不解析 message 内容。
- `history-store` 负责 `message-{n}.jsonl` 与 `message-latest` 读取/写入/搜索；不碰 `current`。
- `session-format` 是 JSONL/manifest 的唯一来源；`toJsonl` / `parseJsonl` 的字段名与顺序不变。
- `durable-fs` 保留 `fsync` 与临时文件语义；不要直接换成 `shared writeFileAtomic`（它没有 directory fsync 语义）。
- `restore()` 的“不写盘”/`restore` checkpoint 行为不变。

### 4.5 `ProcessSupervisor` 残余

目标目录：

```text
src/packages/gateway/src/client-manager/
  index.ts                           # ClientManager facade（106 行，已达标）
  process-supervisor.ts              # 状态机 + start/stop/readiness/restart（≤300）
  client-command.ts                  # ActiveClient、buildClientArgs、command/spawnOptions
  process-termination.ts             # terminate + waitForExit（grace/SIGKILL）
  process-state.ts / restart-policy.ts / health-probe.ts / runtime.ts  # 不改
```

边界规则：

- 状态机、重启策略、健康检查、操作串行化**全部不动**；只移动命令构造与终止流程。
- `buildClientArgs` 的错误文案、reserved args 集合、命令参数顺序不变。
- terminate 的 grace 5s / force 3s、SIGTERM→SIGKILL、日志字段不变。
- 现有 `process-supervisor.test.ts` 不改也应通过；新增测试只做命令/终止的显式断言。

### 4.6 `check-follow-up` / `compress-finalize`

目标：

```text
src/packages/core/src/pipelines/conversation/elements/
  check-follow-up.ts                 # Element shell + 事件/report
  continuation-rules.ts              # 纯规则：runtime/token/reconcile/interrupt/todo/follow-up
  continuation-arbitration.ts        # LLM 仲裁 + 结果校验 + 降级

src/packages/core/src/pipelines/context-compress/elements/
  compress-finalize.ts               # 编排 + report
  compress-commit.ts                 # plan + context put/checkpoint + rollback
  compress-resume.ts                 # orchestrator release/schedule
```

边界规则：

- `continuation-rules.ts` 的规则顺序必须与当前 `doProcess` 完全一致；纯函数返回 `ContinuationDecision | null`，`null` 表示继续到 LLM 仲裁。
- `continuation-arbitration.ts` 不改 timeout（10s）、`maxTokens: 512`、`maxRetries: 0`、abort race、无效转移校验。
- `compress-commit.ts` 保留 checkpoint 失败时的 context entry/token 回滚；`compress-resume.ts` 保留 `resumeTask` / `continuation` / `scheduleConversation` 三条分支。
- 所有 `BusEvents.Element.Data` step 名称与 payload 字段不变。

### 4.7 工具执行与消息投影（CR-DUP-11/12）

目标：

```text
src/packages/core/src/pipelines/conversation/elements/stream/tool-runtime.ts
src/packages/core/src/pipelines/conversation/elements/stream/tool-runtime-mcp.ts
src/packages/core/src/session/message-projection.ts
```

边界规则：

- 内置工具与 MCP 工具共用 `executeGovernedTool()`；差异只在“如何调用底层 execute / 如何归一 metadata”。
- 工具结果通过显式返回值传递；`#toolResults` 不再作为跨函数侧信道。若需要兼容，只保留在 Element 内部一帧。
- `stringifyToolOutput` 只在 `tool-loop.ts` 定义并被 `stream` 模块导入。
- `appendCurrentUserMessage` 变纯函数（返回新数组）；`projectMessages` 统一 reasoning 策略；`isPromptEligibleMessage` 继续作为唯一 eligibility 规则。

### 4.8 TUI chat store / useChat / ChatView

目标：

```text
src/packages/tui/src/
  stores/chat.ts                     # 组合 slices + 兼容 API
  stores/chat/message-slice.ts       # messages/id/transient/update/clear
  stores/chat/stream-slice.ts        # delta/reason/preparing/counters
  stores/chat/tool-slice.ts          # tool group/event/step/complete
  stores/chat/telemetry-slice.ts     # rounds/todos/context/MCP/decisions
  hooks/useChat.ts                   # 组合：refs + lifecycle + send/cancel
  hooks/chat-connection.ts           # TuiClient → store 事件路由
  hooks/chat-errors.ts               # resolveChatClientError
  components/ChatView.tsx            # 渲染
  components/chat-view-model.ts      # placeCompletedToolGroups + 派生
  client/ws-client-protocol.ts       # parseServerEvent + TuiTaskError（行数收尾）
```

边界规则：

- `useChatStore` 的导出名、state 字段、action 名不变；组件不因拆分改 selector。
- 事件顺序不变：snapshot 替换 → telemetry → delta/reason → tool → busy → decision → MCP。
- `prepareForSend` 清空的字段集合不变；`setBusy(false)` 结束 streaming 的行为不变。
- `ChatView` 的“completed tool group 挂到同轮最后一个带 reasoning 的 assistant”规则不变。

### 4.9 TUI panels / App Modal / Wizard reducer

目标：

```text
src/packages/tui/src/components/
  Sidebar.tsx                        # 组合 + re-export（兼容测试 import）
  sidebar/TelemetrySection.tsx
  sidebar/RoundsSection.tsx
  sidebar/TodoSection.tsx
  sidebar/ToolsSection.tsx
  sidebar/NetworkSection.tsx
  RuntimeSidebar.tsx                 # 组合
  runtime/runtime-steps.ts
  runtime/RuntimeSessionSection.tsx
  runtime/RuntimePipelineSection.tsx
  runtime/RuntimeDecisionSection.tsx
  runtime/RuntimeStreamSection.tsx
  runtime/RuntimeStatsSection.tsx
  SettingsModal.tsx                  # 渲染
  settings/settings-model.ts         # modelOptions/serverInfoFromConfig/buildRuntimePatch
  settings/use-settings-config.ts    # load/patch/reset
  InputBar.tsx                       # 渲染 + 组合
  input/use-double-escape.ts         # 双击 ESC / cancel hint / timer
  input/use-command-menu.ts          # filter/menu navigation/command dispatch
  app/AppModal.tsx                   # ModalSpec + 渲染
  App.tsx                            # 布局 + modal state

src/packages/config-tui/src/
  wizard-logic.ts                    # barrel（兼容现有 import）
  wizard/wizard-state.ts             # 类型、默认值、buildInitialState
  wizard/wizard-edit.ts              # pending edit 状态机
  wizard/wizard-commit.ts            # commit/buildProviderEntry/writeEnvKeys
  wizard/wizard-reducer.ts           # UI reducer + route guard
  components/WizardApp.tsx           # 只做 reducer dispatch + render
```

边界规则：

- `Sidebar` / `RuntimeSidebar` 的导出（`SIDEBAR_WIDTH`、`buildGauge`、`derivePipelineSteps`、`TelemetrySection` 等）保持可用；测试 import 不变。
- `SettingsModal` 的 `modelOptions` / `serverInfoFromConfig` / `buildRuntimePatch` 继续导出（可 re-export），测试不变。
- `AppModal` 只替换 Modal 分支；`App.tsx` 的布局、键盘、useChat 调用不变。
- Wizard 的 view 迁移表逐项保留；`quitConfirm` 优先于 view 的 guard 不变；`wizard-logic` 的公开函数继续从 barrel 导出。
- `WizardState.step` 只写不读，可删除；若测试引用 `step`，同步更新。
- `commit()` 保持 S1 的同步原子写语义；不在 S12 改成 async（避免 `onComplete` 时序变化）。

---

## 5. 目标行数预算

> 行数为“实施后目标”，允许 ±15%。拆分通常会让总 LOC 增加 10–20%（imports/类型/README），这是可接受的；验收看**单文件/单函数**与行为，不看总 LOC。

| 模块 | 目标文件 | 目标行数 |
|---|---|---:|
| stream | `stream-llm.ts` | ≤220 |
| stream | `stream/stream-loop.ts` | ≤280 |
| stream | `stream/stream-step.ts` | ≤240 |
| stream | `stream/stream-context.ts` | ≤180 |
| stream | `stream/stream-reporting.ts` | ≤140 |
| stream | `stream/stream-finalize.ts` | ≤130 |
| stream | `stream/stream-model-input.ts` | ≤120 |
| stream | `stream/tool-batch.ts` | ≤200 |
| stream | `stream/tool-runtime.ts` | ≤220 |
| stream | `stream/tool-runtime-mcp.ts` | ≤140 |
| stream | `stream/tool-governance-runtime.ts` | ≤120 |
| stream | `stream/tool-result-status.ts` | ≤100 |
| memory | `memory-service.ts` | ≤180 |
| memory | `memory/memory-store.ts` | ≤260 |
| memory | `memory/memory-query.ts` | ≤170 |
| memory | `memory/memory-graph.ts` | ≤130 |
| memory | `memory/memory-types.ts` | ≤70 |
| context | `context-service.ts` | ≤200 |
| context | `context/bucket-store.ts` | ≤200 |
| context | `context/snapshot-manager.ts` | ≤220 |
| context | `context/context-codec.ts` | ≤100 |
| context | `context/context-types.ts` | ≤100 |
| persistence | `persistence-service.ts` | ≤180 |
| persistence | `session/checkpoint-store.ts` | ≤230 |
| persistence | `session/history-store.ts` | ≤190 |
| persistence | `session/session-format.ts` | ≤150 |
| persistence | `session/durable-fs.ts` | ≤80 |
| supervisor | `process-supervisor.ts` | ≤280 |
| supervisor | `client-command.ts` | ≤100 |
| supervisor | `process-termination.ts` | ≤90 |
| helpers | `check-follow-up.ts` | ≤150 |
| helpers | `continuation-rules.ts` | ≤130 |
| helpers | `continuation-arbitration.ts` | ≤120 |
| helpers | `compress-finalize.ts` | ≤150 |
| helpers | `compress-commit.ts` | ≤130 |
| helpers | `compress-resume.ts` | ≤80 |
| helpers | `message-projection.ts` | ≤120 |
| TUI chat | `stores/chat.ts` | ≤120 |
| TUI chat | `stores/chat/*-slice.ts` | ≤100 each |
| TUI chat | `hooks/useChat.ts` | ≤120 |
| TUI chat | `hooks/chat-connection.ts` | ≤150 |
| TUI chat | `components/ChatView.tsx` | ≤90 |
| TUI chat | `components/chat-view-model.ts` | ≤70 |
| TUI panels | `Sidebar.tsx` | ≤120 |
| TUI panels | `sidebar/*.tsx` | ≤110 each |
| TUI panels | `RuntimeSidebar.tsx` | ≤120 |
| TUI panels | `runtime/*.ts(x)` | ≤100 each |
| TUI panels | `SettingsModal.tsx` | ≤130 |
| TUI panels | `settings/settings-model.ts` | ≤100 |
| TUI panels | `settings/use-settings-config.ts` | ≤120 |
| TUI panels | `InputBar.tsx` | ≤170 |
| TUI panels | `input/*.ts` | ≤100 each |
| TUI App | `App.tsx` | ≤160 |
| TUI App | `app/AppModal.tsx` | ≤180 |
| Wizard | `WizardApp.tsx` | ≤180 |
| Wizard | `wizard/wizard-reducer.ts` | ≤220 |
| Wizard | `wizard/wizard-state.ts` | ≤150 |
| Wizard | `wizard/wizard-edit.ts` | ≤130 |
| Wizard | `wizard/wizard-commit.ts` | ≤120 |
| Wizard | `wizard-logic.ts` | ≤50（barrel） |

### 5.1 最终行数（v1.24.1，2026-11-12）

`bun run check:size` 对 78 个目标文件（0 例外）做 AST 检查；全部通过。关键文件最终行数：

| 模块 | 最终行数 |
|---|---|
| stream | `stream-llm.ts` 90；`stream-run.ts` 214；`stream-loop.ts` 133；`stream-step.ts` 233；`stream-context.ts` 167；`stream-reporting.ts` 78；`stream-reporting-events.ts` 122；`stream-finalize.ts` 113；`stream-overflow.ts` 44；`stream-model-input.ts` 91；`tool-batch.ts` 152；`tool-batch-block.ts` 53；`tool-batch-record.ts` 84；`tool-runtime.ts` 195；`tool-runtime-mcp.ts` 47；`tool-governance-runtime.ts` 64；`tool-result-status.ts` 64；`types.ts` 172 |
| memory | `memory-service.ts` 74；`memory-store.ts` 248；`memory-query.ts` 110；`memory-graph.ts` 86；`memory-types.ts` 39；`memory-schema.ts` 123 |
| context | `context-service.ts` 198；`bucket-store.ts` 194；`snapshot-manager.ts` 166；`context-codec.ts` 52；`context-types.ts` 81；`compiler.ts` 181 |
| persistence | `persistence-service.ts` 146；`checkpoint-store.ts` 167；`history-store.ts` 165；`session-format.ts` 105；`durable-fs.ts` 39；`message-projection.ts` 51 |
| supervisor | `process-supervisor.ts` 277；`client-command.ts` 93；`process-termination.ts` 48 |
| helpers | `check-follow-up.ts` 99；`continuation-rules.ts` 84；`continuation-arbitration.ts` 113；`compress-finalize.ts` 135；`compress-commit.ts` 111；`compress-resume.ts` 35 |
| TUI chat | `stores/chat.ts` 15；slices 37/83/96/43；`useChat.ts` 58；`chat-connection.ts` 150；`chat-messages.ts` 58；`ChatView.tsx` 54；`chat-view-model.ts` 50 |
| TUI panels | `Sidebar.tsx` 40；sidebar sections 17–61；`RuntimeSidebar.tsx` 54；runtime sections 20–45；`SettingsModal.tsx` 88；`settings-model.ts` 94；`use-settings-config.ts` 80；`InputBar.tsx` 128；input hooks 24–94；`App.tsx` 139；`AppModal.tsx` 33 |
| Wizard | `WizardApp.tsx` 46；`wizard-reducer.ts` 189；`wizard-state.ts` 79；`wizard-prefill.ts` 80；`wizard-edit.ts` 115；`wizard-input.ts` 35；`wizard-commit.ts` 76；`WizardViews.tsx` 139；`wizard-logic.ts` 33 |

最长函数为 `InputBar` 98 行（限制 100）；`stream-llm.doProcess` 远低于 100。未列入 section 5 的新实现文件（`stream-run.ts`、`stream/types.ts`、`memory-schema.ts`、`compiler.ts`、`chat-messages.ts`、`WizardViews.tsx` 等）均 ≤300 行，未新增例外。

### 行数目标与例外

S12 目标文件已全部达标；此前的两个显式例外已消除：

| 文件 | 当前行数 | 处理 |
|---|---:|---|
| `src/packages/shared/src/protocol.ts` | **36** | 拆为 `protocol/{client-events,server-events,payloads,guards}.ts`，barrel 保持导出面 |
| `src/packages/core/src/session/context.ts` | **284** | TODO/session 纯 helper 移到 `session/todo.ts`，`SessionContext` 保留 |

`src/packages/tui/src/client/ws-client.ts` 已由 S12-F10 从 304 行降到 276 行（目标 ≤280）。
其余 >300 文件（`bootstrap.ts` 291、`backup.ts` 279、`cli.ts` 278、`shell.ts` 276、`hook-manager.ts` 275、`schedule-service.ts` 272、`fs.ts` 268、`node-http-server.ts` 271 等）均 ≤300 或不在 S12 CR 内，不列入 S12 验收。

---

## 6. 行为不变量

S12 完成后，以下行为必须与 `e3b51f5` 一致。任何一条变化都视为失败。

### 6.1 Pipeline / 事件顺序

| 不变量 | 验证 |
|---|---|
| 5 条 pipeline 的 Element 名称、顺序、kind 不变 | pipeline 构造快照/现有测试 |
| `Task.Activated → Task.Completed/Failed → Pipeline.Result` 顺序不变 | TaskEngine 测试 |
| `BusEvents.Element.Data` 关键 step 顺序不变（`starting LLM call` → `model-step-ended` → `stream-loop-ended` → `done`） | stream 事件快照 |
| `Transport.Reason/Delta/ToolStarted/ToolFinished/ToolStepFinished/ToolGroupComplete` 顺序与 payload 字段不变 | stream 事件快照 |
| `Context.StepCompleted` 在每次 model step 结束时发出，payload 的 session/task/step 不变 | context/stream 测试 |
| `decision-request` / `arbitrated` / `arbitration-failed` 的 payload 不变 | check-follow-up 测试 |

### 6.2 Stream / Tool

| 不变量 | 验证 |
|---|---|
| `maxSteps` 默认 50；循环条件 `modelStep <= maxSteps + 1` 不变 | stream 测试 |
| timeout：mygod 1.8M / hard 900k / medium 600k / default 300k ms | `resolveTimeout` 单测 |
| `beforeCall` 前暂停 timeout、完成后重算剩余时间 | stream boundaries 测试 |
| abortSignal 合并、取消后不再请求模型 | stream boundaries 测试 |
| token overflow 判定阈值 0.8 与返回字段不变 | stream 测试 |
| complete marker `<<<COMPLETE>>>` 只在无 tool call 时检测 | stream 测试 |
| batch 校验：mixed names / not batchable 的错误文案不变 | tool-loop 测试 |
| governance：duplicate / no-progress / max executions 的 stopReason 与输出文案不变 | governance 测试 |
| intent / todowrite 的特殊处理顺序不变（intent 先于 executor；todowrite 更新 todoState/handoff） | stream boundaries 测试 |
| 工具记录：recordPolicy、errorSource、group seal 状态（sealed/interrupted）不变 | stream/tool-record 测试 |
| Context injection：scope fallback topic→session、TTL 续期、commit/release 不变 | stream-llm 测试 |
| token usage：`cumulativeUsage` 与 `contextTokens` 语义不变；cache metrics 字段不变 | stream-cache 测试 |

### 6.3 Memory / Context / Persistence

| 不变量 | 验证 |
|---|---|
| Memory DB 表/索引/trigger/FTS5 tokenizer 与迁移 SQL 不变 | schema dump 快照 |
| `search` 的候选集、过滤、排序、limit、retrieval 记录不变 | memory 测试 + 排序快照 |
| `traverse` BFS 顺序、maxSteps、neighbor 取 3、质量排序不变 | memory 测试 |
| `save` 的 hash、UPSERT、supersedes edge、summary 选择不变 | memory 测试 |
| `retain` 的 `weight + 10`、`last_confirmed_at`、`accessed_at` 不变 | memory 测试 |
| Context bucket id / context id 编码不变 | context 测试 |
| Snapshot `refs/receipts/manifest/prefixHash/estimatedTokens/inputBudget` 不变 | context 快照 |
| `exportSessionState` JSON 字段与过滤条件不变 | persistence/context 测试 |
| checkpoint generation 命名 `g-<12位>-<uuid>`、`current` 软链、兼容软链不变 | persistence 测试 |
| JSONL manifest 字段（type/schemaVersion/archiveId/fromSeq/toSeq/count/createdAt）不变 | persistence 测试 |
| `searchHistory` / `readHistory` 的过滤、排序、limit 不变 | persistence 测试 |
| `restore` 不额外写盘（除 active 的 restore checkpoint）| persistence 测试 |

### 6.4 TUI / WS / Keyboard

| 不变量 | 验证 |
|---|---|
| WS 事件名、envelope、路由表不变 | ws-client 测试 / protocol 测试 |
| snapshot 到达时替换 messages，过滤 visible/role 规则不变 | chat store 测试 |
| telemetry 到达时 rounds/todos/online 更新；断线时清空并插入 error 消息 | useChat/chat store 测试 |
| delta offset 截断 + 追加规则不变；reasoning buffer 只随 delta 消费 | chat store 测试 |
| tool group：首次创建、同 group 更新、完成后 collapse + summary | chat store 测试 |
| busy=false 时结束所有 streaming；prepareForSend 清空字段集合 | chat store 测试 |
| 输入框：Enter submit、Shift+Enter newline、Esc 菜单、双击 Esc 取消、Tab/Up/Down 命令菜单 | InputBar 测试 |
| Modal：action keys、default action、Esc/close、列表导航 | App/Modal/测试 |
| Layout breakpoints 100/150、Sidebar/RuntimeSidebar 显示条件不变 | App 测试 |
| Wizard：first-run/config 的 view 顺序、quitConfirm 优先、`step` 不参与渲染 | WizardApp/wizard reducer 测试 |

---

## 6.5 最终测试矩阵（v1.24.1）

| 场景 | 命令/文件 | 结果 |
|---|---|---|
| stream 特征/边界/缓存/tool loop | `stream-characterization` + `stream-boundaries` + `stream-cache` + `tool-loop` | 29 pass / 0 fail |
| conversation 全量 | `bun test src/packages/core/src/pipelines/conversation` | 156 pass / 0 fail |
| memory schema/search/graph | `bun test src/services/memory-service.test.ts src/services/memory` | 46 pass / 0 fail |
| context + persistence | `bun test src/packages/core/src/context src/packages/core/src/session` | 160 pass / 0 fail |
| gateway supervisor | `bun test src/packages/gateway/src/client-manager` | 45 pass / 0 fail |
| TUI chat/panels | `bun test src/packages/tui/src` | 132 pass / 0 fail |
| wizard view/reducer | `bun test src/packages/config-tui/src` | 79 pass / 0 fail（wizard 子集 71） |
| 全量 source | `bun test --path-ignore-patterns='**/dist/**'` | 1363 pass / 21 skip / 0 fail |
| 全量含 dist | `bun test` | 2483 pass / 21 skip / 0 fail |
| 行数/函数 guard | `bun run check:size` | 78 targets pass / 0 exceptions / 0 fail |

没有新增 skip 或 only；所有矩阵项均有现有测试覆盖，未发现缺口。

## 7. 验收标准（S12 整体）

### 7.1 文件/函数

- [x] 第 5 节列出的**所有目标文件** ≤300 行（`stream-llm.ts` ≤220、`process-supervisor.ts` ≤280 等）。
- [x] 目标文件中所有**导出/成员函数** ≤100 行；`stream-llm.doProcess` ≤100 行。
- [x] 新增 `scripts/check-code-size.ts`：对 S12 目标文件做文件行数 + TS AST 函数体长度检查；允许显式例外清单，但 S12 目标文件不在例外中。
- [x] 第 5 节“无法达到 300 行的例外”保持原状；不得为了达标删除功能或合并职责。
- [x] 不新增模块级可变状态；不新增 `any`（拆分过程中必要的局部类型收口除外，且需注释）。

### 7.2 行为

- [x] 每个阶段先有行为快照/特征测试，再做结构移动；快照断言事件顺序、结果字段、DB 行、目录布局、TUI state 转换。
- [x] pipeline 顺序、Task/Event 顺序、HTTP/WS 路由/事件名、DB schema、文件格式均不变。
- [x] `bun run typecheck` 6/6、`typecheck:node` 0 error。
- [x] `bun test --path-ignore-patterns='**/dist/**'` 0 fail；`bun test` 0 fail。
- [x] `bun run build` 6/6；`smoke:node`、`smoke:node:package` 通过。
- [x] `docs:check` / `docs:typecheck` 通过。
- [x] 每个任务单 commit 可回滚；回滚不影响已发布 Bun/Node 行为。

### 7.3 文档

- [x] 每个新目录有 `README.md`（文件/职责/依赖方向/禁止事项）。
- [x] `docs/overview/project-structure.md`、`docs/overview/architecture.md`、`docs/tui-interface.md`、`docs/subsystems/memory-service.md`、`docs/context-management.md`、`docs/core/session.md` 中涉及的文件地图同步。
- [x] [S12 实施计划](./code-review-s12-plan-2026-11-12.md) 的进度表、最终数字、CR 关闭状态同步。
- [x] 主计划 S12 段落与 `docs/index.md` 链接同步。

---

## 8. 风险与假设

| 风险 | 影响 | 缓解 |
|---|---|---|
| `stream-llm` 循环/工具状态搬移导致行为漂移 | 高回归面 | A1 先做事件/请求/结果快照；每个提取任务只移动一段，保留 re-export；A16 才删旧路径 |
| `#toolResults` 侧信道改为显式返回时丢状态 | 中 | A8 先加显式结果并双读，测试通过后删侧信道 |
| Context snapshot lease/commit 时机变化 | 高 | C6 前后跑 `context-service` + `stream-cache` 全量；不改变 `commitSnapshot` 调用点 |
| checkpoint generation 写入顺序变化 | 高 | D1 固定目录/文件快照；D4 只搬移，不改 fsync/rename 顺序 |
| Memory FTS5/trigger SQL 格式化导致行为变化 | 高 | B3 逐字保留 SQL；schema dump + 搜索排序快照 |
| TUI store 拆分改变 selector/事件顺序 | 中 | F1 先记录 state 转换；F6 用组合 slice 保持 API；组件测试 |
| Wizard reducer 改变 view 顺序 | 中 | G18 先做 view 迁移表测试；G23/G24 只替换 dispatch |
| 行数目标导致过度拆分/总 LOC 膨胀 | 中 | 按行为边界拆，不按行数硬切；目标文件预算允许 ±15% |
| 与后续功能开发冲突 | 中 | S12 先合入结构改动；新功能在 S12 后基于新模块开发 |
| 行数 guard 的 AST API 绑定 TypeScript 7 async API | 低 | `scripts/check-code-size.ts` 使用 `typescript/unstable/async`；TypeScript 升级需同步验证 guard |
| `stream-step`/`process-supervisor`/`chat-connection` 接近预算 | 低 | `stream-step` 233/240、`process-supervisor` 277/280、`chat-connection` 150/150；再增加职责前先拆分 |

> **行数目标**：`bun run check:size` 覆盖 78 个目标文件、0 例外；此前 `protocol.ts` 313 与 `session/context.ts` 309 两个例外已分别降至 36 / 284，最长函数 98 行。

**假设**：

- Node 26 / Bun 1.4 基线不变；不新增运行时依赖。
- 现有测试（S11 后 1095 source pass）是行为基线；S12 只新增特征测试，不改旧断言。
- `tui-kit`、`server.ts`、`TaskEngine` 已稳定，S12 不重新设计它们。
- 没有外部消费者直接 import `memory-service` 的内部类型/私有方法；facade re-export 保证兼容。
- 字符集/终端渲染差异不在自动化范围内；TUI 行为以纯函数/状态测试 + 手工 smoke 为准。

---

## 9. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-12 | 初始 S12 专项审查：基于 `e3b51f5` 盘点 CR-STR-01..11、CR-ARCH-10/11/12、CR-DUP-11/12；标注 CR-STR-02/11 已关闭、CR-STR-06 已缩减；给出目标模块边界、行数预算、行为不变量与验收；仅文档，未改源码 |
| 2026-11-12 | S12 完成（v1.24.0）：A–G 结构与行为快照落地，H1–H4 验收通过；CR-STR-01/03/04/05/06/07/08/09/10、CR-ARCH-10/11/12、CR-DUP-11/12 关闭 |
| 2026-11-12 | S12 例外收尾（v1.24.1）：`protocol.ts` 313→36（client/server/payload/guards），`session/context.ts` 309→284（TODO helper 拆分）；`check:size` 78 targets / 0 exceptions；源码 1363 pass、全量 2483 pass |
