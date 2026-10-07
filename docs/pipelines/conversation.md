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
| 7 | `check-follow-up` | 区分无计划续写和 TODO 续跑 | `executing → ready_to_finalize` |
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

所有工具始终出现在工具列表中，由 LLM 决定调用顺序、参数与次数。Prediction 不预先执行
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
是仅有的强制循环边界。

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

## 6. 自动续写与 TODO 续跑

| action | 含义 | 触发 |
|--------|------|------|
| `follow_up` | 无计划续写 | 长度截断、可恢复错误或显式续写意图 |
| `continue_todo` | 按结构化计划继续 | 本轮没有 follow_up，且存在 pending / in_progress TODO |
| `post_check_retry` | 质量检查后的修复重试 | post-conversation 判定 blocked 且未停滞 |

优先级是 `follow_up > continue_todo`。HTTP 400 级不可恢复错误不会触发续写或 post-check。

`chainDepth` 是统一安全预算，默认上限为 5：

- TODO 达到上限后停止自动续跑并保留状态。
- 普通 follow-up 在检查点转给 evaluator。
- post-check retry 达到上限后终止，避免无限自我修复。

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
| API error | 保存 status code；4xx 不自动续写，其他可恢复错误可 follow-up |

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
  chainAction?: "follow_up" | "continue_todo";
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
