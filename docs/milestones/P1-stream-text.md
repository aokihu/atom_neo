# P1: streamText 流式输出 — 实施方案

## 目标

将 `generateText`（阻塞，等待完整响应）改为 `streamText`（逐字流式输出），让用户通过 WebSocket `transport.delta` 事件实时看到 LLM 回复。

## 当前状态

```typescript
// elements/index.ts — StreamLLMElement
const result = await generateText({
  model, messages, tools, maxSteps: 5, maxTokens: 1024,
});
return { ...input, responseText: result.text };
```

`result.text` 是完整文本，用户必须等 LLM 全部生成完才能看到。

## 改造方案

### 1. StreamLLMElement — generateText → streamText

```typescript
const streamResult = streamText({
  model,
  messages: messages as any,
  tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
  maxSteps: 5,
  maxTokens: 1024,
});

let fullText = "";

for await (const chunk of streamResult.fullStream) {
  if (chunk.type === "text-delta") {
    fullText += chunk.textDelta;
    this.bus.emit("transport.delta" as any, { textDelta: chunk.textDelta } as any);
  }
}
```

### 2. AI SDK v6 API 差异

AI SDK v6 的 `streamText` 返回 `StreamTextResult`，有多个消费方式：

| 方式 | 用途 |
|------|------|
| `result.fullStream` | AsyncIterable，包含所有 chunk 类型（text-delta, tool-call, tool-result 等） |
| `result.textStream` | AsyncIterable<string>，仅文本（简化版） |
| `await result.text` | 等待流结束，返回完整文本（兼容 generateText 行为） |
| `await result.finishReason` | 结束原因 |

**选择 `results.fullStream`**：需要区分 text-delta 和 tool-call chunks，以便发送不同类型的 bus 事件。

### 3. 改动范围

| 文件 | 改动 |
|------|------|
| `elements/index.ts` | StreamLLMElement: `generateText` → `streamText` + for-await |
| 无其他文件 | bus 事件 `transport.delta` 已存在于 `DomainEventMap`，无需修改 |

### 4. 工具调用兼容

`streamText` 支持 `tools` + `maxSteps`，与 `generateText` 行为一致。工具调用结果通过 `tool-call` / `tool-result` chunks 返回。

### 5. 风险

- `for await` 循环会阻塞 element 的 `doProcess`，直到流结束。这是预期行为（pipeline 等待完整响应）。
- 如果流中断，`for await` 抛出错误，被 catch 块捕获。

### 6. 验证

- 启动 server → 提交任务 → 检查 `task.completed` 日志中有完整 responseText
- WebSocket 客户端应收到 `transport.delta` 事件
