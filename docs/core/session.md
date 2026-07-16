# Session & State Management

> **Purpose**: Per-session context model, topic tracking, and TUI lifecycle — how sessions are isolated, managed, and reflected in the UI.

---

## Part 1: SessionContext

## 1. Data Model

```typescript
export class SessionContext {
  readonly sessionId: string;
  readonly createdAt: number;
  #messages: SessionMessage[] = [];
  #nextMessageSeq = 1;
  #inferenceFacts: InferenceFact[] = [];
  #toolContext: ToolContext = { mode: "idle", results: [] };
  #memoryScopes: MemoryScopeState = {
    core: { status: "idle", query: "" },
    short: { status: "idle", query: "" },
    long: { status: "idle", query: "" },
  };
  #continuationContext: ContinuationContext | null = null;
  #currentTopic: string | null = null;
  #tokenUsage: TokenUsage = { total: 0 };
  #chainDepth: number = 0;
  #todoState: TodoItem[] = [];
  pendingPrediction?: IntentPredictionResult;
  compressing = false;
  compressRetry = 0;
  compressRatio = 0;
  #lastSafeMsgCount = 0;
}
```

### 运行时与持久化边界

`messages`、TODO、Continuation、Topic、Token 和推理事实可持久化。以下状态只服务当前进程，恢复时重置：

- `pendingPrediction`
- `compressing`、`compressRetry`、`compressRatio`
- `lastSafeMsgCount`
- Tool loop 中间态、active Task 和 active Snapshot

## 2. Session Store

```typescript
export class SessionStore {
  #sessions = new Map<string, SessionContext>();
  #leases = new Map<string, number>();

  get(sessionId: string): SessionContext {
    return memoryHit(sessionId)
      ?? persistence.restore(sessionId)
      ?? createSession(sessionId);
  }

  // Task lease 期间不执行 idle/capacity 淘汰。
  acquireTask(taskId: string, sessionId: string): void;
  releaseTask(taskId: string): void;
  save(sessionId: string, reason: SessionCheckpointReason): boolean;
}
```

## 3. Key Types

```typescript
type SessionMessage = { seq: number; role: "user" | "assistant" | "system"; content: string; timestamp: number };
type InferenceFact = { key: string; value: string; reason: string };
type ToolContext = { mode: "idle" | "active" | "finished"; results: ToolResult[] };
type ContinuationContext = { summary: string; nextPrompt: string; avoidRepeat: string; updatedAt: number };
type TokenUsage = { total: number };
const TOKEN_BUDGET = 1_000_000;
```

## 4. Task 生命周期集成

```text
Task.Enqueued / Task.Activated → acquireTask(taskId, sessionId)
Task.Completed → checkpoint → Task.Committed
Task.Failed → checkpoint
  → releaseTask(taskId)
```

## 5. Token Usage Tracking

```
AI SDK streamResult.usage
  → {inputTokens, outputTokens, totalTokens}
    ↓
Task.Completed → sessionContext.addTokenUsage(totalTokens) → checkpoint

双重用途:
1. LLM context: collect-context 注入 tokenUsage.total → system prompt
2. TUI display: 侧栏显示 tokens / TOKEN_BUDGET ratio
```

---

## Part 2: Session Persistence

Session 以目录作为最小持久化单元。运行时状态仍由 `SessionContext` 和
`ContextService` 管理，磁盘读写统一交给 `SessionPersistenceService`，避免业务对象同时承担
文件系统职责。

### 1. 目录结构

```text
{sandbox}/.atom/sessions/{safeSessionId}/
├── .checkpoints/
│   ├── g-000000000001-{uuid}/
│   │   ├── session.json
│   │   ├── context.json
│   │   └── message-latest.jsonl
│   └── g-000000000002-{uuid}/
├── current -> .checkpoints/g-000000000002-{uuid}
├── session.json -> current/session.json
├── context.json -> current/context.json
├── message-000001.jsonl
├── message-000002.jsonl
└── message-latest.jsonl -> current/message-latest.jsonl
```

| 文件 | 内容 | 更新方式 |
|------|------|----------|
| `current` | 指向完整 checkpoint generation | 原子 rename；唯一提交点 |
| `session.json` | Session 元数据、Topic、TODO、Continuation、Token 状态和归档游标 | 指向 current generation 的兼容入口 |
| `context.json` | 可恢复的 Session/Topic Context entries | 指向 current generation 的兼容入口 |
| `message-{n}.jsonl` | 压缩产生的不可变原始消息分段 | 只创建，不覆盖 |
| `message-latest.jsonl` | 当前尚未归档的原始消息 | 指向 current generation 的兼容入口 |

目录名必须由统一的安全编码函数根据外部 `sessionId` 生成，禁止直接将外部 ID 拼入路径。
Core 内部读取 latest 时直接解析 `current` 指向的 generation；顶层软链只用于兼容和人工检查，
即使它暂时未修复，也不能让 History Tool 读到旧检查点。

当前实现以“一个 sandbox 同时只有一个 Core writer”为运行约束；同一 sandbox 的多进程写入锁仍需开发，
部署层必须避免两个 Core 共同写同一个 `.atom/sessions` 目录。

### 2. 持久化边界

`session.json` 保存可恢复的任务状态：

- `createdAt`、`updatedAt`、`closedAt`、`closeReason` 和 `status`
- `currentTopic`
- `todoState`
- `continuationContext`
- `tokenUsage`、`contextTokens`
- 消息序号和归档分段游标

以下状态只属于当前进程，恢复时重置：

- `compressing`、`compressRetry`、`compressRatio`
- `pendingPrediction`
- 正在执行的 Task 和 active Snapshot
- Snapshot lease、Step Context 和一次性 Context
- Tool loop 的中间状态

Session 恢复不等于 Task 恢复。重启后恢复状态；旧 checkpoint 若仍为 `active`，会先记录为
`interrupted`。系统不自动执行 active TODO 或重放工具调用，避免重复产生外部副作用。

### 3. Context 持久化

`context.json` 保存 Context 源 entry，不保存已经编译的 TOON Snapshot。只导出：

- active 的 `session` / `topic` scope
- 尚未过期的 entry
- `consumeOnCommit !== true` 的 entry

恢复时由 `ContextService` 导入这些 entry，再重新编译 Snapshot。`task`、`step`、`once`、
Snapshot receipt 和 lease 不进入磁盘状态。

### 4. Checkpoint 提交顺序

三个可变文件写入同一个 generation；`current` 软链的原子切换是唯一提交点。恢复时先锁定
`current` 的目标，再从同一目录读取三份文件并校验 `checkpointRevision`：

```text
1. 创建并校验 message-{n}.jsonl（发生压缩时）
2. 创建 .checkpoints/.g-{revision}.tmp/
3. 写入并 fsync latest/context/session
4. fsync generation 目录并 rename 为 g-{revision}
5. 原子切换 current 并 fsync Session 目录
6. 修复顶层兼容软链，保留 current 与上一代
7. 最后才清理内存中的已归档消息
```

消息使用 Session 内单调递增 `seq`。恢复时按 `seq` 去重，因此崩溃最多留下重复冷归档，不能
造成原始消息丢失。

### 5. 保存时机

| 安全点 | 动作 |
|--------|------|
| 用户消息进入 Session 后、Task 入队前 | 保存 latest 和 Session 状态 |
| Conversation Task 完成、chain 调度前 | 保存 assistant、TODO、Token 和 Context |
| Task 失败 | 保存已经提交的状态 |
| Context 压缩 | 归档成功并 checkpoint 后才删除内存消息 |
| idle / capacity 淘汰 | 保存成功后才从 `SessionStore` 移除 |
| Core 正常关闭 | 停止接收外部任务，drain 已排队和执行中的 Task，保存全部 Session，成功后再清理 Context |

关闭时先 quiesce HookManager 和 ScheduleService，再让 `TaskEngine` 消费已经进入 Waiting/Active Queue
的任务；只有队列和 processing 都为空才停止。shutdown 产生的 Session.Closed 不再启动新 Hook Task。
任一 Session checkpoint 失败时保留内存 Session 与 Context，并让 `stop()` 返回失败，调用方可以重试保存。

Pipeline 内部产生的下游 Task 必须显式携带 `ownerTaskId`，由 `InternalTaskOrchestrator` 暂存在
对应父 Task 下。父 Task checkpoint 成功并发出 `Task.Committed` 后才提交到 TaskQueue；checkpoint
失败则丢弃这组暂存调度；显式 owner 不存在时直接拒绝调度，不能降级为立即入队。WebSocket Compact 等独立请求不携带 owner，立即进入队列，不会被其他
Task 的失败误删。`task:completed` Hook 同样监听 `Task.Committed`，不能绕过保存门。

checkpoint 失败时该 Task 对客户端按失败上报，不写入 completed result，也不广播 TaskCompleted；
Assistant 与 Context 仍留在内存，供 shutdown checkpoint 重试。

`TaskFailed` 同时携带来自 Task `chainId` 的 `rootTaskId`。客户端只拒绝同一 root 的待处理请求；已经完成请求的 post-check、
Hook 等内部 Task 后续失败时，不得通过 FIFO `shift()` 误伤另一个用户请求。

TUI 通过 HTTP 创建 root Task 时必须先检查响应状态和 `taskId`。用户消息 checkpoint 失败返回 500，
或成功响应缺少有效 `taskId` 时应立即拒绝 `send()`，不能创建永远无法匹配事件的 pending 请求。

`message-latest.jsonl` 不能只在退出时保存，否则崩溃或强制终止会丢失最近消息。

### 6. 生命周期语义

| 场景 | Session 状态 | 是否设置 `endedAt` |
|------|--------------|--------------------|
| idle / capacity 淘汰 | `suspended` | 否 |
| Core 正常关闭 | `suspended` | 否 |
| 异常退出后恢复到旧 active checkpoint | `interrupted` | 否 |
| 用户显式结束 | `completed`（需要开发结束接口） | 是 |
| 不可恢复失败 | `failed`（需要开发失败终结策略） | 是 |

`closedAt` 表示本次离开内存的时间，`endedAt` 只表示 Session 永久结束。

### 7. 恢复流程

```text
SessionStore.get(sessionId)
  ├── memory hit → 返回现有 SessionContext
  └── memory miss
      ├── 目录不存在 → 创建新 Session
      └── 目录存在
          ├── 读取 session.json
          ├── 读取 context.json
          ├── 加载 message-latest.jsonl
          ├── 校验三个 checkpointRevision 完全一致
          ├── 建立 message-{n}.jsonl 冷归档索引
          └── 返回恢复后的 SessionContext；旧 active checkpoint 记录为 interrupted
```

只读 Session 查询使用 `SessionStore.load(sessionId)`：内存或磁盘存在时返回 Session，不存在时返回
`null`，不会创建 Session、触发 Session Started Hook 或占用缓存。只有接收新消息的写路径使用 `get()`。

历史分段不批量加载到 Session 内存；Agent 仅在需要核对原始对话时通过
`search_history` / `read_history` 按需读取。

---

## Part 3: Topic System

## 1. 设计原则

- **系统驱动切换** — topic 由 prediction pipeline 自动检测，LLM 不参与切换决策
- **保留历史** — 切换时保留 messages/inferenceFacts/memoryScopes/tokenUsage
- **重置任务状态** — todoState/chainDepth/toolContext/continuationContext 清空

## 2. Topic 格式

```
<category>.<domain>.<specific>
categories: creative | tools | code | knowledge | chat
```

| 示例 | 含义 |
|------|------|
| `creative.history.ancient` | 创作：古代历史文章 |
| `tools.filesystem.explore` | 工具：浏览文件系统 |
| `code.warehouse.management` | 编码：仓库管理系统 |

## 3. 触发流程

```
用户输入 → predict-intent → 5字段分类（含 topic）
  → predict-finalize:
    ├─ newTopic !== session.currentTopic → resetForNewTopic(newTopic)
    └─ newTopic === session.currentTopic → 保持上下文
  → collect-context: 注入 [主题约束] 到 context
  → stream-llm: activeTools 由 intent 独立控制
```

## 4. resetForNewTopic()

```typescript
resetForNewTopic(topic: string): void {
  this.#currentTopic = topic || null;
  this.#todoState = [];
  this.#chainDepth = 0;
  this.#toolContext = { mode: "idle", results: [] };
  this.#continuationContext = null;
  // 保留: #messages, #inferenceFacts, #memoryScopes, #tokenUsage, sessionId
}
```

## 5. 双重边界

| 边界层 | 实现 | 效果 |
|--------|------|------|
| 主题约束 | context 注入 + activeTools | LLM 被约束在主题范围内 |
| 工具过滤 | intent → getActiveToolNames() | instruction→17工具, question→12工具, creative→11工具, conversation→8工具 |

---

## Part 4: Session Lifecycle (TUI)

## 1. 问题

Spinner 生命周期绑定在"第一个 text delta"时刻，但真正的会话结束是 TaskCompleted（根任务 resolve）。两者之间有时间差，链式任务期间 TUI 无指示器。

| 场景 | 现象 | 后果 |
|------|------|------|
| 链式任务间隙 | 文本输出完了，内部在做 follow_up | 用户屏幕空白 |
| 纯工具响应 | 无文本输出，spinner 永不消失 | 用户困惑 |
| 流式结束后 | 文本完成但 TaskCompleted 未到 | 用户提前输入 |

## 2. 方案：sessionBusy

```
send() 调用 → sessionBusy = true
  ├── thinking msg (spinner) — 无文本输出时
  ├── 文本开始 → thinking 移除, StatusLine ⏳ processing
  ├── 工具执行 → StatusLine ⏳ processing
  └── 链式任务间隙 → thinking msg — 无文本输出时
send() resolve/reject → sessionBusy = false → 一切清空
```

## 3. TUI 规则

| 条件 | Spinner | StatusLine |
|------|---------|-----------|
| `sessionBusy && 无文本 && 无运行中工具` | 显示 | `⏳ processing...` |
| `sessionBusy && (有文本 \|\| 工具运行中)` | 隐藏 | `⏳ processing...` |
| `!sessionBusy` | 隐藏 | 隐藏 |

执行中按一次 `ESC` 显示取消提示；2 秒内再次按 `ESC`，TUI 使用当前
`SessionTaskActive.taskId` 发送 `event.task.cancel`。Core 从该 Task 解析 `chainId`，
一次性取消同一 Session 中整条 Task Chain 的 queued、processing 与 staged 成员。
取消完成后显示 `Task cancelled by user` 临时提示，并在 2 秒后自动移除；同时由
`SessionTaskActive(active=false)` 结束 busy 状态。取消失败保留普通错误消息。
命令菜单打开时，第一次 `ESC` 只关闭菜单，不计入任务取消。

## 4. 关键设计

- **sessionBusy 覆盖链式任务** — `send()` 的 await 等到根 TaskCompleted 才 resolve
- **工具执行期间 StatusLine 持续** — 配合 `tool.state === "running"` 检查
- **第一个 text delta 后 spinner 不再需要** — 文本正在输出，用户可见

## 5. 涉及文件

```
src/packages/tui/src/hooks/useChat.ts    sessionBusy state
src/packages/tui/src/components/App.tsx  isProcessing → sessionBusy 驱动
src/packages/core/src/session/context.ts SessionContext 数据模型
```

## 6. StatusBar 模型信息展示

StatusBar 显示当前模型名称及 thinking 模式状态（始终显示 `[thinking]` 标签，颜色区分状态）：

| 字段 | 来源 | 显示格式 |
|------|------|----------|
| `model` | `RuntimeService.getResolvedModel().model` | `deepseek-v4-flash` |
| `thinking` | `RuntimeService.getResolvedModel().thinking` | `[thinking]` 标签，绿色=enabled，黄色=adaptive，灰色=disabled |

```text
atom neo ▎ ● connected ▎ deepseek-v4-flash [thinking] ▎ v1.3.7
                                        ^^^^^^^^ 绿色/黄色/灰色 = enabled/adaptive/disabled
```

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [task-execution.md](./task-execution.md) | TaskEngine 如何驱动 session 状态 |
| [pipeline-dev.md](./pipeline-dev.md) | Pipeline 中如何使用 SessionContext |
| [../pipelines/conversation.md](../pipelines/conversation.md) | Conversation Pipeline — stream-llm 如何触发 sessionBusy |
