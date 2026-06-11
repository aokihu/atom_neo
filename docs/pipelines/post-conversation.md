# Post-Conversation Pipeline

> **Purpose**: 每轮对话完成后分析结果质量，判定是否需要重试。

## 触发方式

```
conversation pipeline → finalize → Conversation.Chain (post_check_retry)
  → orchestrator.scheduleConversation() → ... → stream-llm 完成后
  → pipelineBuilders["post-conversation"] → postConversationPipeline(deps).build(bus)
```

## Element 链（3 个元素）

```
post-collect-input (source)
  → post-analyze-result (transform)
  → post-finalize (sink)
```

| 顺序 | Element | Kind | 职责 |
|------|---------|------|------|
| 1 | `post-collect-input` | source | 提取最后一轮用户消息和助手回复 |
| 2 | `post-analyze-result` | transform | 调用 LLM 分析回复质量（satisfactory / blocked） |
| 3 | `post-finalize` | sink | blocked → 设置重试引导词 + 发出 Conversation.Chain 事件 |

## FlowState

```typescript
type PostConversationFlowState = {
  mode: "initial" | "analyzing" | "acting";
  task: any;
  session: any;
  userMessage: string;
  assistantResponse: string;
  predictedTaskIntent: string;
  stepCount: number;
  assistantParts: number;
  analysis?: AnalysisResult;
};

type AnalysisResult = {
  status: "satisfactory" | "blocked";
  reason: string;
};
```

## 状态转移

```
initial
  → post-collect-input:  提取最后用户消息 + 助手回复（截断 1500 字符） → analyzing
  → post-analyze-result: LLM 分析质量 → acting
  → post-finalize:       blocked → bus.emit(Conversation.Chain) / satisfactory → 无操作
```

## Element 详解

### post-collect-input

**kind**: `source`

**职责**: 从 session 中提取最后一条用户消息和所有后续助手回复。

- 读取 `session.messages`，找到最后一个 `role: "user"` 的消息
- 收集其后所有助手消息，截断每段至 1500 字符（`PromptKey.TRUNCATION_MARKER`）
- 读取 `session.pendingPrediction` 获取 `intent` 和 `stepCount`

### post-analyze-result

**kind**: `transform`

**职责**: 调用分析 LLM 判断回复质量。

- **门控**: 无 `apiKey`、无消息或分析结果时跳过，默认 `{ status: "satisfactory" }`
- **System Prompt**: `resolvePrompt(PromptKey.ANALYZE_RESULT, ...)`
- **User Prompt**: 用户请求（前 500 字符）+ AI 回复（前 3000 字符）+ 任务类型描述
- **参数**: temperature=0, maxTokens=256
- **输出**: JSON `{ status: "satisfactory" | "blocked", reason: string }`
- **容错**: LLM 调用或 JSON 解析失败 → fallback `{ status: "satisfactory", reason: "skip" }`

### post-finalize

**kind**: `sink`

**职责**: 根据分析结果决策。

- `status === "satisfactory"` → 返回 `PipelineResult { type: "complete" }`，无操作
- `status === "blocked"` → 设置 `session.postCheckGuidance` 为 `resolvePrompt(PromptKey.GUIDANCE_RETRY)`，发出 `BusEvents.Conversation.Chain(post_check_retry)` 事件 → 外部链处理器会重新调用 conversation pipeline

## 设计要点

| 机制 | 说明 |
|------|------|
| **Fail-safe 优先** | 每个阶段都有 fallback，默认 `satisfactory`。LLM 调用失败、无 API Key、输入为空 → 不阻塞对话 |
| **重试通过事件触发** | pipeline 自己不重试，通过 `Conversation.Chain` 事件让外部调度器重试 |
| **Token 安全** | 用户消息截断 500 字符，助手回复截断 3000 字符 |
| **400 错误跳过** | 当 conversation pipeline 的 `errorStatusCode >= 400` 时，`finalize.ts` 不发射 `Conversation.Idle`，彻底跳过 post-conversation 分析（空输出"blocked"误判导致死循环） |
| **chainDepth 限制** | `post_check_retry` 分支在 server.ts 中受 `maxChainDepth` 约束（默认 5），防止消息损坏导致的无限重试循环 |
| **API 错误容错** | post-analyze-result LLM 调用失败时 fallback `{ status: "satisfactory", reason: "skip" }`，不标记 blocked |

## Deps

```typescript
type PostConversationPipelineDeps = {
  session: any;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
};
```

## 文件

```
src/packages/core/src/pipelines/post-conversation/
  index.ts                          pipeline 定义 + 元素注册
  elements/
    types.ts                        PostConversationFlowState
    index.ts                        barrel export
    collect-input.ts
    analyze-result.ts
    finalize.ts
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [conversation.md](./conversation.md) | post-conversation 的触发链路 |
| [prompts.md](./prompts.md) | ANALYZE_RESULT 和 GUIDANCE_RETRY 提示词 |
