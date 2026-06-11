# Prediction Pipeline

> **Purpose**: 用户意图预分类 — 用 basic 模型做轻量级分类，输出任务复杂度、模型级别、任务类型、上下文关联度。

## 职责

在正式会话之前，用 basic 模型对用户意图做轻量级分类，输出任务复杂度、所需模型级别、任务类型、上下文关联度，供 conversation pipeline 优化执行。

## 触发方式

```
POST /api/tasks → createTaskHandler → taskQueue.enqueue(pipeline="prediction")
  → TaskEngine → pipelineBuilders["prediction"] → predictionPipeline().build(bus)
```

## Element 链

```
predict-input (source) → predict-intent (transform) → predict-finalize (sink)
```

| 顺序 | Element | Kind | 职责 |
|------|---------|------|------|
| 1 | `predict-input` | source | 提取用户消息 + 最近对话上下文 |
| 2 | `predict-intent` | transform | 调用 `generateText`（非流式），输出 `IntentPredictionResult` |
| 3 | `predict-finalize` | sink | 写入 `session.pendingPrediction`，调度 conversation 任务 |

## FlowState

```typescript
type PredictionMode = "initial" | "predicting" | "routing";

type PredictionFlowState = {
  mode: PredictionMode;
  task: any;
  session: any;
  userMessage: string;
  contextMessages?: string;
  prediction?: IntentPredictionResult;
  error?: string;
};
```

## 状态转移

```
initial
  → predict-input:   提取消息 + 上下文 → predicting
  → predict-intent:  调用 LLM 分类     → routing
  → predict-finalize: 写入 session     → PipelineResult { type: "complete" }
```

## 预测输出

```typescript
type IntentPredictionResult = {
  difficulty: "easy" | "medium" | "hard" | "mygod";      // 任务复杂度 → 执行策略
  modelProfile: "basic" | "balanced" | "advanced";        // 所需推理能力 → 模型选择
  intent: "instruction" | "question" | "creative" | "conversation";  // 任务意图 (Anthropic 风格)
  contextRelevance: "standalone" | "follow_up" | "continuation";
  topic: string;                                          // 主题标签 → 会话状态管理
  reasoning: string;
};
```

## 分类维度详解

### difficulty（任务复杂度）

| 值 | 含义 | 执行策略 |
|-----|------|---------|
| `easy` | 单步问答 | 直接回答，无需 todo |
| `medium` | 中等复杂度 | 视情况判断是否用 `todowrite` |
| `hard` | 复杂多步任务 | 必须用 `todowrite` 逐项执行，每项完成后更新进度并调用 intent(follow_up) |
| `mygod` | 超大规模任务 | 同 hard，且每步完成后必须验证结果 |

### modelProfile（模型选择）

| 值 | 含义 |
|-----|------|
| `basic` | 轻度推理足够（简单问答、短文本） |
| `balanced` | 中等推理深度（代码生成、多文件变更） |
| `advanced` | 深度推理（复杂调试、架构分析） |

### intent（任务意图 — Anthropic 风格）

重命名为 Anthropic 标准意图分类，与工具白名单直接关联：

| 值 | 场景示例 | 可用工具数 |
|-----|---------|-----------|
| `instruction` | 执行命令、写代码、重构、操作文件 | 17 (全量) |
| `question` | 信息询问、查天气、查记忆、文档搜索 | 12 |
| `creative` | 写长文、设计架构、生成内容 | 11 |
| `conversation` | 闲聊、简短问答、讨论 | 8 |

每个 intent 通过 `getActiveToolNames()` 控制工具可见性，减少无关工具 token 开销。

### contextRelevance（上下文关联）

| 值 | 含义 | collect-prompts 行为 |
|-----|------|---------------------|
| `standalone` | 新话题，不需要历史 | 只保留最近 2 轮消息 |
| `follow_up` | 基于上一轮的追问 | 保留全部可见消息 |
| `continuation` | 明示继续之前任务 | 保留全部可见消息 + 不 reset chainDepth |

### topic（主题标签）

| 格式 | 示例 | 用途 |
|------|------|------|
| `<category>.<domain>.<specific>` | `creative.history.ancient`, `tools.filesystem.explore` | 会话状态管理 |

Topic 由 predict-intent LLM 生成，在 predict-finalize 阶段与 session 已有 topic 比对：

- **相同** → 保持上下文（todoState, chainDepth, toolContext 等）
- **不同** → `session.resetForNewTopic(newTopic)` — 清空 todoState/chainDepth/toolContext/continuationContext，但保留 messages/inferenceFacts/memoryScopes/tokenUsage
- **首次** → 设置 topic，无状态可清

design: [session.md](../core/session.md#part-2-topic-system)

### difficulty 与 modelProfile 分离

两个字段独立判断，互不绑定：
- "写 20 段历史文章" → `difficulty: hard`（范围大）但 `modelProfile: balanced`（无需深度推理）
- "调试并发死锁" → `difficulty: medium`（一个问题）但 `modelProfile: advanced`（需要深度推理）
- "2+2 等于几" → `difficulty: easy`, `modelProfile: basic`

## Deps

```typescript
type PredictionPipelineDeps = {
  session: any;           // → predict-input
  task: any;              // → predict-input
  apiKey: string;         // → predict-intent
  model: string;          // → predict-intent
  baseUrl?: string;       // → predict-intent
  maxTokens?: number;     // → predict-intent
  orchestrator: InternalTaskOrchestrator;  // → predict-finalize
};
```

## 错误处理

| 场景 | 行为 |
|------|------|
| 预测 LLM 调用失败 | `catch` → fallback `{ difficulty: "medium", modelProfile: "balanced", intent: "conversation", topic: "" }` |
| API 400 错误 (如消息损坏) | fallback 同上，不阻塞对话 |
| 空用户消息 | fallback 同上 |
| 无 apiKey | fallback 同上 |
| 无 JSON 响应 | fallback 同上 |

无论如何都会调度 conversation pipeline，不会阻塞用户对话。

## 文件

```
src/packages/core/src/pipelines/prediction/
  index.ts                          pipeline 定义 + deps 类型
  elements/
    types.ts                        PredictionFlowState, PredictionPipelineDeps
    index.ts                        barrel export
    predict-input.ts                提取消息
    predict-intent.ts               调用 LLM 分类
    predict-finalize.ts             写入 session + 调度
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [conversation.md](./conversation.md) | Prediction 结果如何触发 Conversation Pipeline |
| [session.md](../core/session.md#part-2-topic-system) | predict-intent 生成的 topic 标签 |
| [prompts.md](./prompts.md) | predict-intent 使用的提示词 |
