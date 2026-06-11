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
compress-input (source) → compress-summarize (transform) → compress-finalize (sink)
```

| 顺序 | Element | Kind | 职责 |
|------|---------|------|------|
| 1 | `compress-input` | source | 读取 `session.compressRatio` 确定 5 档策略，分割对话消息。保留最近 N 条，归档旧消息并拼接为 summaryText |
| 2 | `compress-summarize` | transform | 调用 LLM（**独立 basic profile 模型**）生成 500 字以内摘要。失败时 `compressRatio += 0.4` 自动升级 |
| 3 | `compress-finalize` | sink | 归档旧消息到磁盘、调用 `replaceEarlyMessages(keepCount)` 清理 session、设置 `compressing=false`、调度续写 |

## FlowState

```typescript
type CompressMode = "initial" | "summarizing" | "finalizing";

type CompressFlowState = {
  mode: CompressMode;
  task: any;
  session: any;             // 含 compressRatio, compressing, compressRetry
  archiveMessages: Array<{ role: string; content: string; timestamp: number }>;
  summaryText: string;
  summary?: string;
};
```

## 状态转移

```
initial
  → compress-input:      分割消息（保留 20，归档其余） → summarizing
  → compress-summarize:  LLM 生成摘要                  → finalizing
  → compress-finalize:   归档 + 清理 + 调度              → PipelineResult
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
对话消息 → filter(user/assistant only)
  → slice(-20): 保留 → 截断超长内容到 2000 字
  → slice(0, -20): 归档 → 拼接为 summaryText
```

### 摘要生成（compress-summarize）

- 调用 LLM，prompt：`将以下对话历史总结为 500 字以内的摘要，保留关键信息、决策和进展。`
- `maxTokens: 600`, `temperature: 0`（确定性输出）
- 无 text 或 apiKey 时跳过

### 归档与清理（compress-finalize）

```
archiveMessages > 0
  → archiveMessages(sandbox, sessionId, messages)  // 写入磁盘
  → session.replaceEarlyMessages(20)               // 截断内存中的消息
  → session.conversationSummary = 摘要              // 下一轮 dialogue 注入
  → orchestrator.scheduleConversation()             // 恢复对话
```

归档路径：`{sandbox}/{sessionId}/archive/`

## Deps

```typescript
{
  session: any;         // → compress-input (含 compressRatio 等压缩参数)
  task: any;
  apiKey: string;       // → compress-summarize (basic profile 独立 key)
  model: string;        // → compress-summarize (basic profile 独立模型)
  baseUrl?: string;     // → compress-summarize
  orchestrator;         // → compress-finalize
  sandbox: string;      // → compress-finalize (归档路径)
}
```

## 错误处理

| 场景 | 行为 |
|------|------|
| 归档文件写入失败 | `catch` → report warn，不阻塞 `replaceEarlyMessages` |
| LLM 摘要失败 | `catch` → summary = ""，finalizing 继续 |
| 无摘要文本 | 跳过 LLM 调用，direct finalizing |

## 文件

```
src/packages/core/src/pipelines/context-compress/
  index.ts                          pipeline 定义
  elements/
    types.ts                        CompressFlowState
    index.ts                        barrel export
    compress-input.ts
    compress-summarize.ts
    compress-finalize.ts
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [conversation.md](./conversation.md) | Token 使用统计和压缩触发条件 |
| [follow-up-evaluator.md](./follow-up-evaluator.md) | evaluator 如何触发 context-compress |
| [prompts.md](./prompts.md) | compress-summarize 使用的提示词 |
