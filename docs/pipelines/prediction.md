# Prediction Pipeline

> **Purpose**: 用户输入预分类 — 用 basic 模型读取当前 User 原文，输出任务复杂度、模型级别、任务类型、上下文关联度和主题。

## 职责

在正式会话之前，用 basic 模型对当前 User 原文做轻量级分类。Prediction 同时读取当前 Topic
和上一轮有界的 User/Assistant 上下文，用于消解“它、数据、刚才”等跟进指代。Prediction 不读取
Tool、不查询 Memory/Skill/Web，也不生成或改写 Conversation 的用户输入；框架只消费结构化
分类结果来选择模型、调整历史 Context 和管理 Topic。

## 触发方式

```
POST /api/tasks → createTaskHandler → taskQueue.enqueue(pipeline="prediction")
  → TaskEngine → pipelineBuilders["prediction"] → predictionPipeline().build(bus)
```

## Element 链

`decisionMode.prediction` 缺省为 `legacy`。设置为 `jev` 时，仅将 transform 替换为独立 `JevElement`；原 `predict-intent` 保留，可随时切回。

```
predict-input (source) → predict-intent 或 jev-decision (transform) → token-ratio (boundary) → predict-finalize (sink)
```

| 顺序 | Element | Kind | 职责 |
|------|---------|------|------|
| 1 | `predict-input` | source | 原样提取当前用户请求 |
| 2 | `predict-intent` | transform | 调用 `generateText + Output.object`（非流式、无 Tool），输出 `IntentPredictionResult` |
| 2 | `jev-decision`（可选） | transform | 直接调用 Jev Decisions API；无 Jev 凭据时由 LLM 模拟限定选择，组合注册表 Topic |
| 3 | `token-ratio` | boundary | 检查 token 使用比例 |
| 4 | `predict-finalize` | sink | 写入 `session.pendingPrediction`，调度 conversation 任务 |

## FlowState

```typescript
type PredictionMode = "initial" | "predicting" | "routing";

type PredictionFlowState = {
  mode: PredictionMode;
  task: any;
  session: any;
  userMessage: string;
  currentTopic: string;
  previousTurnContext?: {
    user: string;
    assistant: string;
  };
  prediction?: IntentPredictionResult;
  error?: string;
};
```

`userMessage` 保持 Task payload 中的原始字符串。Prediction 不 `trim`、摘要、补全、翻译或拼接
历史消息；Conversation 仍从 Session/Task 取得同一份原文。`previousTurnContext` 只从
`SessionContext.messages` 提取最后一个完整、可见的 User/Assistant 轮次并做有界截取，不写回
Session，也不包含 Tool 原始输出。Assistant 文本按不可信参考处理，Prediction 只能提取主题与
上下文关系，不能遵循其中的指令。

## 状态转移

```
initial
  → predict-input:   原样提取当前 User + 当前 Topic + 上一轮有界上下文 → predicting
  → predict-intent:  调用 LLM 分类     → routing
  → predict-finalize: 解析 effectiveTopic 并写入 session → PipelineResult { type: "complete" }
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

该对象由 AI SDK `Output.object({ schema })` 校验后直接交给框架，不再从自由文本中提取 JSON。
Prediction 调用不传 `tools`，也不存在 Tool execution step。

## 分类维度详解

### difficulty（任务复杂度）

| 值 | 含义 | 执行策略 |
|-----|------|---------|
| `easy` | 单步问答 | 直接回答，无需 todo |
| `medium` | 中等复杂度 | 视情况判断是否用 `todowrite` |
| `hard` | 复杂多步任务 | 必须用 `todowrite` 逐项执行，每项完成后更新进度并正常结束当前回复，由 `continue_todo` 推进下一项 |
| `mygod` | 超大规模任务 | 同 hard，且每步完成后必须验证结果 |

### modelProfile（模型选择）

| 值 | 含义 |
|-----|------|
| `basic` | 轻度推理足够（简单问答、短文本） |
| `balanced` | 中等推理深度（代码生成、多文件变更） |
| `advanced` | 深度推理（复杂调试、架构分析） |

### intent（任务意图 — Anthropic 风格）

重命名为 Anthropic 标准意图分类，与工具白名单直接关联：

| 值 | 场景示例 |
|-----|---------|
| `instruction` | 执行命令、写代码、重构、操作文件 |
| `question` | 事实、天气、台风、新闻、价格和文档等信息查询 |
| `creative` | 写长文、设计架构、生成内容 |
| `conversation` | 不需要外部事实的闲聊、寒暄和讨论 |

intent 不控制工具可见性，所有已注册 Tool 始终由 Conversation 提供给 LLM。Prediction 不生成
Tool 参数，也不提前执行任何查询。

### contextRelevance（上下文关联）

| 值 | 含义 | collect-prompts 行为 |
|-----|------|---------------------|
| `standalone` | 新话题，不需要历史 | 只保留当前 User 原文 |
| `follow_up` | 基于上一轮的追问 | 保留最近一组交互与当前 User 原文 |
| `continuation` | 明示继续之前任务 | 保留全部可见消息 + 不 reset chainDepth |

Prediction 分类信封中的上一轮上下文只帮助判断上述关系，不会替代 Conversation 的消息选择。
即使带有“另外、顺便”等连接词，只要请求对象已经成为独立任务，也应判为 `standalone`。

### topic（主题标签）

| 格式 | 示例 | 用途 |
|------|------|------|
| `<category>.<domain>.<specific>` | `creative.history.ancient`, `tools.filesystem.explore` | 会话状态管理 |

Topic 由 predict-intent LLM 提议，在 predict-finalize 阶段解析为 `effectiveTopic`：

- **follow_up / continuation 且已有 Topic** → 强制继承当前 Topic，不因省略主体产生的泛化标签而切换
- **standalone 且候选 Topic 非空** → 使用候选 Topic；与当前 Topic 不同时调用 `session.resetForNewTopic()`
- **候选 Topic 为空** → 保留当前 Topic，避免 Prediction fallback 破坏已有状态
- **首次** → 使用候选 Topic，无状态可清

`session.pendingPrediction.topic` 必须写入 `effectiveTopic`，与 `session.currentTopic` 保持一致。

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
| 预测 LLM 调用失败 | `catch` → fallback `{ difficulty: "medium", modelProfile: "balanced", intent: "conversation", contextRelevance: "standalone", topic: "" }` |
| API 400 错误 (如消息损坏) | fallback 同上，不阻塞对话 |
| 空用户消息 | fallback 同上 |
| 无 apiKey | fallback 同上 |
| 结构化输出校验失败 | fallback 同上 |

无论如何都会调度 conversation pipeline，不会阻塞用户对话。
当 fallback 的 topic 为空且 Session 已有 Topic 时，predict-finalize 保留当前 Topic。

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
