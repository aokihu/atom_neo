# Prediction Pipeline

## 职责

在正式会话之前，用 basic 模型对用户意图做轻量级分类，输出工具需求、任务类型、上下文关联度，供 conversation pipeline 优化执行。

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
  toolTier: "basic" | "full";
  difficulty: "basic" | "balanced" | "advanced";
  taskIntent: "tool_execution" | "creative_generation" | "knowledge_retrieval" | "conversation";
  contextRelevance: "standalone" | "follow_up" | "continuation";
  reasoning: string;
};
```

## 分类维度详解

### toolTier

| 值 | 含义 |
|-----|------|
| `basic` | 仅需读写文件、搜索、目录列表、基础记忆 |
| `full` | 需要 shell 命令、网络访问、批量文件操作、记忆图谱遍历 |

### difficulty

| 值 | 含义 |
|-----|------|
| `basic` | 单步操作 |
| `balanced` | 多步任务、代码生成 |
| `advanced` | 系统设计、架构重构、复杂调试 |

### taskIntent（P9 扩展）

| 值 | 场景示例 | conversation 行为 |
|-----|---------|-----------------|
| `tool_execution` | 执行命令、查天气、读写文件 | 传 full 工具集，开启 memory search，保留全部上下文 |
| `creative_generation` | 写长文、编代码、翻译 | **不传任何工具**，关闭 memory search，保留全部上下文 |
| `knowledge_retrieval` | 搜索知识库、查记忆 | 传搜索类工具，开启 memory search，保留全部上下文 |
| `conversation` | 闲聊、问答、解释 | 传 basic 工具（不含 search_memory），关闭 memory search |

### contextRelevance（P9 扩展）

| 值 | 含义 | collect-prompts 行为 |
|-----|------|---------------------|
| `standalone` | 新话题，不需要历史 | 只保留最近 2 轮消息 |
| `follow_up` | 基于上一轮的追问 | 保留全部可见消息 |
| `continuation` | 明示继续之前任务 | 保留全部可见消息 + 不 reset chainDepth |

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
  logger?: Logger;        // → 内部 debug
};
```

## 错误处理

| 场景 | 行为 |
|------|------|
| 预测 LLM 调用失败 | `catch` → fallback `{ toolTier: "basic", difficulty: "balanced" }` |
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
