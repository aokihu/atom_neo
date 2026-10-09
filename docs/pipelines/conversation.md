# Conversation Pipeline

> **Purpose**: 将 Session 消息和分层 Context 编译成一次 LLM 调用，并在安全提交后决定是否续写、推进 TODO、压缩或进入质量检查。

## 1. 当前主链

```text
collect-prompts (source)
  → record-context (transform)
  → apply-source-context (transform)
  → collect-context (transform)
  → stream-llm (transform)
  → token-ratio (boundary)
  → check-follow-up (boundary)
  → finalize (sink)
```

| 顺序 | Element | 职责 | mode 变化 |
|------|---------|------|-----------|
| 1 | `collect-prompts` | 按 Prediction 分类从 Session 选择历史，始终保留当前 User 原文 | `initial → streaming` |
| 2 | `record-context` | 将 System、AGENTS、Skill、环境与 TODO 记录到 ContextService，同时生成去重后的 messages | `streaming → context_recorded` |
| 3 | `apply-source-context` | 应用显式 Source Context，不读取 Tool 审计历史 | mode 不变 |
| 4 | `collect-context` | 从 ContextService 创建不可变静态文本 + 动态 TOON Snapshot | `context_recorded → formatted` |
| 5 | `stream-llm` | 调用单 step AI SDK，手工执行 Tool Loop，更新治理 metadata 和 Context 投影 | `formatted → executing` |
| 6 | `token-ratio` | 基于输入上限和输出保留预算计算占用比 | mode 不变 |
| 7 | `check-follow-up` | 统一仲裁当前续写、TODO 推进与进度核对 | `executing → ready_to_finalize` |
| 8 | `finalize` | 提交或释放 Snapshot，返回 chain / post-check 决策 | 返回 PipelineResult |

旧的 `load-system-prompt`、`fetch-agents-prompt`、`inject-skill-context`、
`format-system-messages` 和 `format-user-messages` 不在当前主链中；相关职责已经聚合到
`record-context`、`collect-context` 与 `stream-llm`。

## 2. 送入 LLM 的结构

```text
ContextService entries
  ├── system prompt
  ├── workspace AGENTS
  ├── active Skill sections
  ├── task environment / TODO
  ├── selected Memory summaries
  ├── durable Memory projections
  └── conversation summary / archive index
          ↓ collect-context
      混合 Context Snapshot
          ↓
AI SDK
  system: snapshot.content
  messages: visible user / assistant messages；Assistant reasoning 使用 AI SDK reasoning part
  tools: schema-only tools（不向 AI SDK 提供 execute）
```

Snapshot 是一次调用的只读快照；编译状态、receipt、lease 和生命周期仍由 ContextService 内部管理，
不会注入 LLM。

### 当前用户消息去重

HTTP / WebSocket 在 Task 入队前已经把用户消息写入 Session。`record-context` 只有在最后一条消息
不是同一份用户文本时才追加 payload，避免同一个输入出现两次。兼容元素
`format-user-messages` 复用同一个 `appendCurrentUserMessage()` 规则。

## 3. Context 记录边界

`record-context` 负责写来源数据，不直接拼最终 system string：

| Scope | Key | 来源 | 生命周期 |
|-------|-----|------|----------|
| system | `system-prompt` | Prompt Registry | pinned |
| workspace | `workspace-agents` | AGENTS compiler | pinned |
| session / topic | `topic-skills` | SkillService | 随 Topic / Session |
| task | `task-environment` | 当前时间、sandbox、TODO、预算 | Task |
| session / topic | Memory projection | `read_memory` 显式选择 | pinned 或 TTL |

`collect-context` 只从 ContextService 获取 Snapshot，不再重复搜索 Memory 或拼装业务数据。

## 4. Tool 自主调用与循环保护

正常执行时所有工具出现在工具列表中，由 LLM 决定调用顺序、参数与次数。进度核对仅开放并允许执行 `todowrite`。Prediction 不预先执行
Memory 查询，WebFetch 也没有 Memory/Skill 的框架前置门控。Prompt 明确要求 LLM 在
WebFetch 前先查询 Memory 与 Skill；顺序由 LLM 遵守，框架不维护业务状态。

一个模型 step 可以返回多个 Tool Call，但必须满足“同名批次”契约：

- 多个 Call 的 `toolName` 必须完全相同，不允许在同一 step 混合不同工具。
- 只有 `ToolDefinition.allowSameToolBatch=true` 的无副作用查询工具允许同名多调用；默认关闭。
- 写入、控制、Skill 状态工具、支持 POST 的 WebFetch，以及未知 MCP/插件 Tool 每 step 只能调用一次。
- 批次仍按 Call 顺序逐个执行；整批结果全部返回后，LLM 才能在下一 step 选择其他 Tool。
- 违反契约时整批在 executor 之前拒绝，每个 `call_id` 都返回配对失败结果，不执行任何部分调用。

```text
LLM Tool Call
  → mixed names or non-batchable multi-call? reject the whole batch
  → exact duplicate? block once and tell LLM to reassess
  → otherwise execute Tool
  → return the Tool Call + Tool Result to the next model step
  → repeated no-result? add a warning, keep every Tool available
  → execution limit reached? stop the Tool loop
```

框架不根据 `effect` 隐藏正常 Tool Result，不动态收窄 Tool，也不替 LLM决定查询是否相关。
同名批次校验只维护执行原子性和顺序，不承担业务相关性判断。
`metadata.effect` 只用于日志、Post 分析和无进展提醒。

### 工具结果生命周期

- Tool schema 与 executor 分离；AI SDK 不自动执行 Tool，也不维护多 step Tool Loop。
- 每个已执行 Tool 的 Call + Result 都投影到当前 Conversation 后续 step，包括空结果与错误。
- 产生 Tool Call 的 Assistant step 同时投影该 step 的 reasoning、可见文本和 Tool Call；文本也进入流式输出与最终 Session 消息。
- MCP 成功结果按 `reference` 投影到当前 Conversation，Conversation 结束后丢弃。
- Tool Result 不自动把完整内容写入 Topic/Session Context；真实执行结果写入当前 Conversation 的
  ToolsGroup，下一次 Snapshot 只暴露 TOON 摘要。
- `read_memory` 只有显式传入 Context projection 参数时才成为 pinned 或 TTL Context。

### ToolsGroup 与 ToolRecord

- Conversation 首次产生可记录的真实结果时创建一个 `ToolsGroupID`。
- `Step` 是 Conversation 级记录序号，从 1 开始，只对真实 Tool 成功和真实 Tool 失败递增。
- Guard/Runtime 错误仍返回当前模型 step，但不写记录、不占 Step。
- `request_tool_record` / `request_tool_records` 返回历史详情，但自身不写记录。
- 有界的完整 input/output 留在 ToolRecordStore，超限标记 `truncated`；Context 只接收分组摘要和最近记录摘要。

```text
Tool Result
  ├─ current modelMessages: 完整 Call/Result 配对
  ├─ ToolRecordStore: 真实执行的完整详情
  ├─ ContextService: 结构化摘要，由 compiler 转成 TOON
  └─ Runtime logs: Guard、Runtime 与真实执行的完整可观测事件
```

### 手工 Tool Loop

```text
streamText（单 step，schema-only tools）
  → 收集 reasoning、可见文本和 Tool Calls
  → 提交每个 step 的可见文本，按输出顺序累积
  → 同名批次预检；非法批次整批拒绝
  → Ledger 预检 / 去重 / 预算
  → Atom ToolRunner 按 Call 顺序执行
  → 返回 Assistant reasoning / 文本 / Tool Call + Tool Result 给下一模型 step
  → metadata.effect 只更新 Ledger 计数
  → 连续无进展只追加判断提示；Tool schema 保持开放
  → 无 Tool Call或框架停止
  → 提交全部可见 Assistant 文本，并保存本轮 reasoning 供续写使用
```

下一 step 的模型消息由 Atom 重新构建，不使用 AI SDK 自动累积的 `responseMessages`。Atom 保持
Tool Call/Result 配对，保留 Tool step 的 Assistant 内容，不筛选正常结果。历史 Assistant 的
`reasoningContent` 经 `record-context` 保留，并在 `stream-llm` 转成 AI SDK reasoning part，供 DeepSeek 的 thinking mode
续写请求序列化为 `reasoning_content`；日志不记录 reasoning 原文。完全重复的 Tool Call 与执行总上限
以及成功的 follow_up、当前 TODO 交接和受限核对，共同构成工具循环边界。

`todowrite` 在执行前按已有的 `TodoWriteInputSchema` 校验参数。缺少 `todos` 等无效输入
返回 Tool 失败结果，不更新 Session 的 TODO 状态；模型可依据该失败结果修正下一次调用。

## 5. 输出预算与压缩阈值

`maxOutputTokens` 由 Atom 自己传给 AI SDK，默认 4096。Context 输入预算为：

```text
inputBudget = contextLimit - maxOutputTokens - CONTEXT_RESERVE
effectiveLimit = contextLimit - maxOutputTokens
ratio = contextTokens / effectiveLimit
```

系统在输入空间接近阈值时启动压缩，不等到输出 token 完全耗尽。`tokenOverflow` 时 Finalize 计算
`compressRatio`，并通过 orchestrator 暂存 `context-compress` Task。
`finishReason=length` 表示单次输出预算已用尽；已生成的可见文本必须先进入 Session，再由
`follow_up` 接着输出。输入占用比低不能排除单次输出预算耗尽。

| compressRatio | 保留最近消息 | Summary 上限 |
|---------------|--------------|--------------|
| `< 0.3` | 20 | 400 |
| `0.3–0.6` | 10 | 600 |
| `0.6–0.9` | 5 | 800 |
| `0.9–1.2` | 2 | 1200 |
| `≥ 1.2` | 1 | 1600 |

## 6. 续写仲裁与 TODO 交接

跟踪参数先完整验证，再比较精简组合与 JEV 承担更多判断的方案，见 [参数对照实验](./progress-evidence-experiment.md)。仲裁与整体检查共享正文引用、当前任务事实和裁剪范围；消息 metadata 保存 target、before/after、terminalCause。已删除字数累计、长度解析、相似度和续写统计；JEV 保留 contentState、reasonCode、evidenceRef，续写增加 intentScope。原因码只用于诊断，调度由专门判断与 Runtime 约束校验；正文只提供一次。

`check-follow-up` 是唯一续写决策入口：Runtime 提供事实，规则优先，冲突时使用 Jev。
Agent 通过 TODO 保存进度，通过 `intent.follow_up` 请求继续当前内容；intent 不自行推进计划。
`<<<COMPLETE>>>` 是整体完成声明，不能覆盖截断、未完成 TODO 或错误。

| decision.kind | chain action | 行为 |
|---------------|--------------|------|
| resume_current | follow_up | 从断点继续当前内容，不自动完成 TODO |
| advance_todo | continue_todo | 根据已保存的计划执行剩余工作 |
| reconcile_progress | reconcile_todo | 只调用 todowrite 核对状态，不重写正文 |
| finish | 无 | 进入 Post-Conversation 整体检查 |

本轮保存执行前后的 TODO 和当前项快照（位置、内容）；首次建计划选取 in_progress。
当前项被成功标记 completed/cancelled 后结束工具循环，保存后再交接。成功的
intent.follow_up 同样结束本轮，不强制追加正文；无效 intent 返回错误供模型纠正。
retain_memory 仍执行记忆确认，不终结对话。

取消、不可恢复错误和工具治理停止禁止自动恢复；上下文溢出沿用压缩。
长度截断和可恢复中断直接恢复当前内容。明确交接直接推进。显式 intent 与 TODO 并存、
完成标记与 active TODO 冲突、进行中任务自然停止、列表变更导致身份不明时调用 Jev。
Jev 只选择四种 decision；未完成 TODO 禁止 finish，没有可靠交接禁止 advance_todo。
非法选择、调用失败或 rules 模式下的歧义进入核对，仲裁器不修改 TODO。
已有 pending 计划且本轮没有正文或计划变更时，可以直接开始下一项；新建计划没有 in_progress 或有正文但无法确认当前项时，仍属于需要核对的歧义。
已执行的 continuation_request 与近期重复正文作为证据输入。正文完全重复且 TODO 没有变化时，
禁止再次接受 resume_current；in_progress 本身不能证明正文尚未完成。

核对 conversation 使用 continuation_request，只开放 todowrite，最多两次工具尝试，
有效更新后结束；没有实际进度变更则停止并明确报告未确认，禁止默认成功。
正文和参考摘录有界，裁剪标记不能被当作完整证据；Agent 参数是参考，Runtime 目标是约束。

ContinuationDecision 经 finalize、Conversation.Chain、Orchestrator 到 TaskPayload 的
continuation_request 完整透传，包括目标、summary、nextPrompt 和 avoidRepeat。
检查点和压缩恢复保留该请求。所有三类动作共用全局/局部预算和窗口健康评估；
全局额度用尽明确暂停、保留 TODO；局部窗口满先检查。post_check_retry 也经过同一入队预算入口。
日志记录候选、依据、来源 rules/jev/llm/fallback、最终目标与选择；概率和置信度只用于诊断。

### 调试捕获（2026-10-08）

复用现有 `element.data -> Logger.debug` 通道，只在 debug 日志等级写入；不增加配置、仲裁输入字段、模型调用或调度行为。新增事件不属于 `decision-updated`，不会进入客户端决策状态消息。

| 记录点 | 调试数据 | 用途 |
|---|---|---|
| `decision-request` | 实际选择的模型及 jev/llm 来源、发送的 state/questions、会话/任务/父任务/根任务/Snapshot 标识 | 复现评估范围与实际正文摘录；不记录 provider 凭据、请求头或配置 |
| `model-step-ended` / `stream-loop-ended` | 任务关联、实际 todowrite 是否开放、循环退出分支、当前项、TODO 前后状态、核对尝试与治理状态 | 区分模型自然停止、工具被关闭、进度未回写与显式交接 |
| `reconciliation-result` / `done` | incomingContinuation、前后 TODO、是否变更、目标匹配、实际决定与规则依据 | 追踪核对为什么允许交接，不能将工具成功作为内容验收 |
| Orchestrator `task-staged` / `task-scheduled` | 新任务 ID、requestedByTaskId、parentTaskId、rootTaskId、pipeline、continuation | 关联产生原始仲裁的任务和核对任务；staged 不代表已保存或执行 |
| 保存后及深度检查 | taskId、continuation、当前/最大深度 | 解释保存、预算与最终推进行为 |

正文沿用实际判断输入中的有界摘录，不额外采集整篇正文或 reasoning；状态与问题不另行裁剪，否则无法判断真实请求。新日志只作观察，不修改 TODO、JEV 问题、token 上限或链深度。自然停止与核对无变更仍保持现有行为。

## 7. Snapshot 与下游任务提交顺序

Finalize 只返回决策。Pipeline 内部调用 orchestrator 时必须传入当前 `ownerTaskId`，任务只暂存在
对应父 Task 下；WebSocket Compact 等独立请求没有 owner，直接入队：

```text
Pipeline completes
  → finalize commits / releases Context Snapshot
  → Task.Completed
      → append Assistant message
      → add token usage
      → checkpoint Session + Context + latest messages
          ├── success
          │   → Task.Committed
          │   → Conversation.Chain / Conversation.Idle
          │   → release staged downstream tasks and hooks
          └── failure
              → discard staged downstream tasks
              → keep Session in memory
```

`TaskEngine` 串行执行 Task。`Task.Committed` 是“父 Task 的 Session 状态已安全落盘”的信号；
需要启动下游工作的 Hook 不能直接监听原始 `Task.Completed`。

## 8. 流式输出安全

| 机制 | 行为 |
|------|------|
| Atom ToolCallLedger | 控制手工工具循环，默认最多 50 次执行、连续 3 次无进展 |
| `<<<COMPLETE>>>` | 使用滑动窗口跨 chunk 识别，标记及之后文本不发送 |
| offset | Transport delta 携带完整文本偏移，TUI 按 offset 合并 |
| Unicode | `substringWellFormed()` 安全截断；`sanitizeForJSON()` 使用 `toWellFormed()` 修复孤立代理 |
| API error | 保存 status code；沿用现有 HTTP ≥400 停止分支，其他可恢复中断可 follow-up |

字面量 `\u`、Windows 路径和代码属于合法文本，不能被 JSON sanitizer 改写。

## 9. 关键 FlowState

```typescript
type ConversationMode =
  | "initial"
  | "streaming"
  | "context_recorded"
  | "formatted"
  | "executing"
  | "ready_to_finalize";

type ConversationFlowState = {
  mode: ConversationMode;
  task: TaskItem;
  prompts?: Message[];
  contextOwner?: ContextOwner;
  contextSnapshot?: ContextSnapshot;
  contextSnapshotAccepted?: boolean;
  memorySearchAttempted?: boolean;
  memorySearchStatus?: "not_started" | "found" | "empty" | "unavailable";
  injectedMemoryCount?: number;
  userMessages?: Message[];
  responseText?: string;
  reasoningContent?: string;
  chainAction?: "follow_up" | "continue_todo" | "reconcile_todo";
  continuationDecision?: ContinuationDecision;
  todoBefore?: TodoItem[];
  currentTodo?: TodoTarget;
  tokenUsage?: TokenUsage;
  tokenOverflow?: boolean;
  errorStatusCode?: number;
  finishReason?: string;
  completeDetected?: boolean;
};
```

## 10. 关键文件

```text
src/packages/core/src/pipelines/conversation/
  index.ts
  elements/
    collect-prompts.ts
    record-context.ts
    apply-source-context.ts
    collect-context.ts
    stream-llm.ts
    check-follow-up.ts
    finalize.ts
    types.ts

src/packages/core/src/pipelines/shared/token-ratio.ts
src/packages/core/src/context/context-service.ts
src/packages/core/src/server.ts
src/packages/core/src/task/internal-task-orchestrator.ts
```

## 双层执行预算（2026-10-09）

目标完成后的界面归零：Post 仅对实际取得的有效 satisfactory 判定返回 `completedGoalId`（回退默认成功不确认完成，有 assessment 时要求 contentState=complete）。该标识取自检查开始时的目标快照。Core 校验仍为当前目标、无未完成 TODO、暂停或待执行请求后，保存 `executionBudget.completed=true` 并推送 telemetry；保存失败撤销完成标记。TUI 据此把 ROUNDS/WINDOW 的已用次数显示为 0，保留限额及真实累计计数。新业务轮次释放或被预算拦截时清除完成标记；重启/重连从已保存状态恢复。

conversation.maxGlobalRounds 默认100（正整数）；maxLocalRounds 默认5，允许5～10。显式旧 maxChainDepth 按后续轮次换算为全局额度 maxChainDepth+1，新字段优先；不改写用户文件。目标预算独立于 Topic，明确新目标建立新记录；同目标恢复、核对、Post 重试及压缩通过统一入队检查，不重置全局累计。

释放前先保存正文/进度，再保存预算扣减；尚未释放的暂存不计数，保存失败不入队。窗口健康检查优先 JEV，失败后 LLM 模拟一次（分别10秒、512 tokens、零重试）；healthy 只重置局部，不健康或 unknown 保留待执行请求并暂停。精确“继续”/continue 跳过 Prediction，全局暂停追加额度，其他暂停重查原窗口。完整任务载荷和续写参数持久化并在压缩后保留。

详见 [健康检查](../pipelines/follow-up-evaluator.md)。
