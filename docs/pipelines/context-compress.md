# Context Compress Pipeline

> **Purpose**: Token 超限自动压缩 — 归档旧消息到磁盘、生成 LLM 摘要、清理 session、恢复对话。

## 职责

当对话上下文接近 token 上限时，将旧消息归档到磁盘、生成 LLM 摘要、清理 session 消息，然后恢复对话。

## 触发方式

两种触发路径：

```
1. follow-up-evaluator pipeline → evaluate-finalize
     ├── tokenUsage.total > contextLimit * 80% && health !== "stuck"
     └── → orchestrator.scheduleCompress() → TaskEngine
         → pipelineBuilders["context-compress"] → contextCompressPipeline().build(bus)

2. conversation pipeline → stream-llm token overflow → finalize (Retry)
     ├── 检测条件: stepCount===0 && fullTextLen===0 && !timedOut
     └── → TaskEngine.reEnqueue(conversation) + orchestrator.scheduleCompress() → TaskEngine
         → compress 先执行 (activeQueue.pop LIFO) → conversation 再执行 (拿到压缩后的 session)
```

> **安全边界模式**：由 token overflow 触发的压缩使用 `SessionContext.lastSafeMsgCount`。
> 只压缩上次成功会话之前的旧消息，保留成功边界之后的新消息。
> 这确保压缩 LLM 不会二次溢出（输入量已知在可控范围内）。

## Element 链

```
compress-input (source) → compress-summarize (transform) → compress-finalize (sink)
```

| 顺序 | Element | Kind | 职责 |
|------|---------|------|------|
| 1 | `compress-input` | source | 分割对话消息。普通模式：保留最近 20 条；安全边界模式：保留 `lastSafeMsgCount` 之后的消息，仅压缩之前的旧消息 |
| 2 | `compress-summarize` | transform | 调用 LLM 生成 500 字以内的对话摘要 |
| 3 | `compress-finalize` | sink | 归档旧消息到磁盘、清理 session、调度续写 |

## FlowState

```typescript
type CompressMode = "initial" | "summarizing" | "finalizing";

type CompressFlowState = {
  mode: CompressMode;
  task: any;
  session: any;
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
  session: any;         // → compress-input
  task: any;
  apiKey: string;       // → compress-summarize
  model: string;        // → compress-summarize
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
