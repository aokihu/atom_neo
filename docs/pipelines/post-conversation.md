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
| 2 | `post-analyze-result` | transform | 调用 LLM 分析回复质量 + 生成行为指纹 |
| 3 | `post-finalize` | sink | 三态决策：satisfactory → 结束 / needs_user_input → 结束 / blocked → 指纹停滞检测 → retry 或 stall |

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
  status: "satisfactory" | "blocked" | "needs_user_input";
  reason: string;
  fingerprint?: string;  // 归一化行为描述（≤20字，去除修饰语）
};
```

## 状态转移

```
initial
  → post-collect-input:  提取最后用户消息 + 助手回复（截断 1500 字符） → analyzing
  → post-analyze-result: LLM 分析质量 + 生成 fingerprint → acting
  → post-finalize:
      satisfactory       → 无操作，结束
      needs_user_input   → 无操作，结束（等待用户补充信息）
      blocked            → 指纹停滞检测:
                             相似度 > 0.6 → stalled，结束
                             相似度 ≤ 0.6 → 存储指纹 → Conversation.Chain(post_check_retry)
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

**职责**: 调用分析 LLM 判断回复质量并生成行为指纹。

- **门控**: 无 `apiKey`、无消息或分析结果时跳过，默认 `{ status: "satisfactory" }`
- **System Prompt**: `resolvePrompt(PromptKey.ANALYZE_RESULT, ...)`
- **User Prompt**: 用户请求（前 500 字符）+ AI 回复（前 3000 字符）+ 任务类型描述
- **参数**: temperature=0, maxTokens=256
- **输出**: JSON `{ status: "satisfactory" | "blocked" | "needs_user_input", reason: string, fingerprint?: string }`
- **容错**: LLM 调用或 JSON 解析失败 → fallback `{ status: "satisfactory", reason: "skip" }`

#### 三态判定规则

| 状态 | 说明 | 示例 |
|------|------|------|
| `satisfactory` | AI 直接回答了问题，提供了实质信息 | 返回天气数据 |
| `blocked` | AI 未完成任务，但也没有合理原因 | 工具调用失败后无内容 |
| `needs_user_input` | AI 向用户追问了缺失信息 | "请告诉我城市名称" |

#### Fingerprint 字段

`fingerprint` 是 LLM 对 AI 行为的归一化描述（≤20字），剥离修辞差异：

```
AI回复1: "请问您想查询哪个城市呢？"
→ fingerprint: "询问用户提供城市名称"

AI回复2: "请告诉我城市名称"
→ fingerprint: "询问用户提供城市名称"
```

fingerprint 用于**停滞检测**（见下文），两个回复即使措辞不同，只要 fingerprint 相同或高度相似，即被判定为停滞。

### post-finalize

**kind**: `sink`

**职责**: 根据分析结果和停滞检测决策。

- `status === "satisfactory"` → 返回 `PipelineResult { type: "complete" }`，无操作
- `status === "needs_user_input"` → 返回 `PipelineResult { type: "complete" }`，无操作
- `status === "blocked"` → **指纹停滞检测**:
  1. 与 `session.postCheckFingerprints[]` 中所有历史指纹计算 trigram Jaccard 相似度
  2. 若最大相似度 > `STALL_THRESHOLD`（0.6） → **stalled**，不再重试
  3. 若最大相似度 ≤ 0.6 → 存储指纹，设置 `session.postCheckGuidance`，发出 `BusEvents.Conversation.Chain(post_check_retry)`

### 停滞检测算法

使用 **trigram Jaccard 相似度**比较两个 fingerprint：

```typescript
function trigramSimilarity(a: string, b: string): number {
  const tA = trigrams(a);
  const tB = trigrams(b);
  const intersection = tA.intersection(tB);
  const union = tA.union(tB);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
```

使用 ES2025 原生 `Set.prototype.intersection()` / `Set.prototype.union()`，Bun 1.3+ 原生支持。

### 两道防线

```
Layer 1 (语义):  needs_user_input  ──→ 明确不重试（prompt 级别）
Layer 2 (统计):  fingerprint stall ──→ 相似度 > 0.6 不重试（算法级别）
```

Layer 1 拦截已知模式（追问、澄清等）。Layer 2 作为通用兜底：任何未经分类的停滞模式，只要 fingerprint 高度相似，都会被拦截。

### 停滞检测案例

```
场景: 用户问"天气"，AI反复问"请告诉城市"，evaluator逐次判定blocked

步骤1: AI回复 "请问您想查询哪个城市？"
  fingerprint: "询问用户提供城市名称"
  session.postCheckFingerprints = ["询问用户提供城市名称"]

步骤2: AI回复 "请告诉我城市名称，我来查询天气"
  fingerprint: "追问城市名称并请求查询天气"
  trigramSimilarity("询问用户提供城市名称", "追问城市名称并请求查询天气") ≈ 0.72 > 0.6
  → stalled，停止重试

步骤3: AI回复 "已通过搜索获取杭州天气" (如果AI换策略，真的查了天气)
  fingerprint: "查询并返回了天气数据"
  trigramSimilarity(prev, new) ≈ 0.15 < 0.6
  → 允许通过，因为行为确实不同
```

## 设计要点

| 机制 | 说明 |
|------|------|
| **Fail-safe 优先** | 每个阶段都有 fallback，默认 `satisfactory`。LLM 调用失败、无 API Key、输入为空 → 不阻塞对话 |
| **重试通过事件触发** | pipeline 自己不重试，通过 `Conversation.Chain` 事件让外部调度器重试 |
| **Token 安全** | 用户消息截断 500 字符，助手回复截断 3000 字符 |
| **400 错误跳过** | 当 conversation pipeline 的 `errorStatusCode >= 400` 时，`finalize.ts` 不发射 `Conversation.Idle`，彻底跳过 post-conversation 分析（空输出"blocked"误判导致死循环） |
| **chainDepth 限制** | `post_check_retry` 分支在 server.ts 中受 `maxChainDepth` 约束（默认 5） |
| **停滞检测** | trigram Jaccard 指纹相似度 > 0.6 → stalled。防止相似回复的死循环重试 |
| **ES2025 Set** | 使用原生 `Set.intersection()` / `Set.union()`，Bun ≥1.3 原生支持 |

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

src/packages/core/src/pipelines/shared/
  trigram.ts                        trigramSimilarity() 函数

src/packages/core/src/session/
  context.ts                        postCheckFingerprints 存储

src/packages/shared/src/prompts/variants/lang/
  zh.ts / en.ts                     ANALYZE_RESULT prompt
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [conversation.md](./conversation.md) | post-conversation 的触发链路 |
| [prompts.md](./prompts.md) | ANALYZE_RESULT 和 GUIDANCE_RETRY 提示词 |
