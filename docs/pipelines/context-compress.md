# Context Compress Pipeline

> **Purpose**: Token 超限自动压缩 — 归档旧消息到磁盘、生成 LLM 摘要、清理 session、恢复对话。

## 职责

当对话上下文接近 token 上限时，将旧消息归档到磁盘、生成 LLM 摘要、清理 session 消息，然后恢复对话。

## 触发方式

两种触发路径：

```
1. conversation pipeline → finalize (tokenOverflow)
     ├── 计算 compressRatio = max(0, (tu/effectiveLimit - 0.8) * 5)
     ├── session.compressing = true (单锁，防重复压缩)
     └── → orchestrator.scheduleCompress() → TaskEngine
         → pipelineBuilders["context-compress"] → contextCompressPipeline().build(bus)

2. follow-up-evaluator pipeline → evaluate-finalize
     ├── tokenUsage.total > contextLimit * 80% && health !== "stuck"
     └── → orchestrator.scheduleCompress() → TaskEngine
         → compress 先执行 → conversation 再执行 (拿到压缩后的 session)
```

> **去重机制**：使用 `session.compressing` 单锁，压缩期间全周期覆盖（compressing=true）。conversation finalize 和 evaluator finalize 如果在 `compressing===true` 时触发压缩会被跳过。

## Element 链

```
compress-input (source)
  → compress-archive (transform)
  → compress-summarize (transform)
  → compress-finalize (sink)
```

| 顺序 | Element | Kind | 职责 |
|------|---------|------|------|
| 1 | `compress-input` | source | 从 Session 原始消息中选择完整前缀；可见 user/assistant 消息单独用于摘要 |
| 2 | `compress-archive` | transform | 通过 `SessionPersistenceService` 可靠写入不可变 `message-{n}.jsonl`；失败时停止提交 |
| 3 | `compress-summarize` | transform | 使用“旧累计摘要 + 本次可见消息”生成新的累计摘要 |
| 4 | `compress-finalize` | sink | checkpoint latest/context/session，成功后按 `seq` 清理内存前缀并恢复原 Conversation |

## FlowState

```typescript
type CompressMode = "initial" | "archiving" | "summarizing" | "finalizing";

type CompressFlowState = {
  mode: CompressMode;
  task: any;
  session: any;             // 含 compressRatio, compressing, compressRetry
  archiveMessages: SessionMessage[]; // Session 原始消息的完整前缀
  summaryMessages: SessionMessage[]; // archiveMessages 中可见的 user/assistant
  archiveReceipt?: ArchiveReceipt;
  archiveError?: string;
  keepCount?: number;
  summaryText: string;
  summary?: string;
  summaryError?: string;
  summaryMaxTokens: number;
};
```

## 状态转移

```
initial
  → compress-input:      选择原始消息前缀                    → archiving
  → compress-archive:    写不可变 JSONL                     → summarizing
  → compress-summarize:  旧摘要 + 新消息生成累计摘要         → finalizing
  → compress-finalize:   checkpoint + 清理 + 恢复原任务      → PipelineResult
```

## 关键行为

### 压缩比策略

`compressRatio` 由触发方（conversation/evaluator finalize）计算，存储在 `session.compressRatio`。`compress-input` 读取 ratio 选择策略：

```typescript
compressRatio = max(0, (tokenUsage / effectiveLimit - 0.8) * 5);
// effectiveLimit = configContextLimit - maxTokens (保留输出空间)
```

**5 档策略表**：

| compressRatio | keepCount | maxSummaryTokens | 说明 |
|---------------|-----------|------------------|------|
| < 0.3 | 20 | 400 | 轻度压缩 |
| 0.3 – 0.6 | 10 | 600 | 中度压缩 |
| 0.6 – 0.9 | 5 | 800 | 强力压缩 |
| 0.9 – 1.2 | 2 | 1200 | 激进压缩 |
| ≥ 1.2 | 1 | 1600 | 极限压缩 |

**自动升级**：`compress-summarize` LLM 调用失败时 `compressRatio += 0.4`（上限 2.0），`compressRetry > 1` 时同样升级，逐步加大压缩力度。

### 独立模型配置

压缩使用独立的 **`basic` profile** 模型，不与 conversation 共享 balanced 配置：

```typescript
const compressResolved = runtime.getResolvedModel("basic") ?? resolved;
// 使用独立的 apiKey / model / baseUrl
```

未配置 `basic` profile 时回退到 `resolved`（当前 conversation 模型）。此举避免 thinking 参数兼容性问题，且降低成本。

### 消息分割（compress-input）

```
Session 原始消息
  → archiveMessages：待归档的完整前缀
  → keepMessages：保留的完整后缀
  → summaryMessages：archiveMessages 中 visible !== false 的 user/assistant
```

归档集合和删除集合必须是同一批原始消息，不能先过滤消息再按数量删除 Session 原数组。

### 摘要生成（compress-summarize）

- 输入由当前 `conversation-summary` 与本次 `summaryMessages` 组成，生成覆盖全部冷历史的累计摘要。
- 调用 LLM，prompt：`将以下对话历史总结为 500 字以内的摘要，保留关键信息、决策和进展。`
- `maxTokens` 按压缩比动态取 400–1600，`temperature: 0`（确定性输出）
- 无 text 或 apiKey 时跳过

### 归档与清理

```
archiveMessages > 0
  → 写 message-{n}.jsonl.tmp
  → 校验行数并 rename 为不可变分段
  → 更新 conversation-summary / history-archive-index
  → checkpoint message-latest.jsonl + context.json + session.json
  → 按 seq 删除成功归档的内存消息
  → 使用专用“从截断处继续”指令恢复 Conversation，避免重复注入原始用户请求
```

归档路径：`{sandbox}/.atom/sessions/{safeSessionId}/message-{n}.jsonl`

Context Snapshot 只注入累计摘要和归档索引，不注入 JSONL 正文。Agent 需要核对原文时使用
`search_history` / `read_history`，读取结果只在当前 AI SDK step 中存在。

## Deps

```typescript
{
  session: any;         // → compress-input (含 compressRatio 等压缩参数)
  task: any;
  apiKey: string;       // → compress-summarize (basic profile 独立 key)
  model: string;        // → compress-summarize (basic profile 独立模型)
  baseUrl?: string;     // → compress-summarize
  orchestrator;         // → compress-finalize
  persistence;         // → compress-archive / compress-finalize
  contextService;      // → 累计摘要、归档索引和 checkpoint
}
```

## 错误处理

| 场景 | 行为 |
|------|------|
| 归档文件写入失败 | 停止压缩提交，不删除任何 Session 消息，不调度恢复任务 |
| checkpoint 失败 | 保留内存消息；已创建的冷分段可在恢复时按 seq 去重 |
| LLM 摘要失败 | 停止提交，不删除内存消息、不调度续写；已写归档可按 `seq` 幂等复用 |
| 无摘要文本 | 跳过 LLM 调用，direct finalizing |

## 文件

```
src/packages/core/src/pipelines/context-compress/
  index.ts                          pipeline 定义
  elements/
    types.ts                        CompressFlowState
    index.ts                        barrel export
    compress-input.ts
    compress-archive.ts
    compress-summarize.ts
    compress-finalize.ts
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [conversation.md](./conversation.md) | Token 使用统计和压缩触发条件 |
| [follow-up-evaluator.md](./follow-up-evaluator.md) | evaluator 如何触发 context-compress |
| [prompts.md](./prompts.md) | compress-summarize 使用的提示词 |
