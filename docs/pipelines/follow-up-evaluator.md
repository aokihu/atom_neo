# Follow-Up Evaluator Pipeline

> **Purpose**: 链式续写检查点 — 每 3 轮或深度超限时评估对话健康度，分类为 healthy/looping/stuck/degrading，必要时干预。

## 职责

在链式续写的检查点（每 3 轮或达到深度上限）评估对话健康度，分类为 healthy/looping/stuck/degrading，干预不健康的对话。

## 触发方式

```
BusEvents.Conversation.Chain handler in server.ts
  ├── depth >= conversation.maxChainDepth (默认 5)
  ├── depth >= 3 && depth % 3 === 0
  └── → orchestrator.scheduleEvaluator() → TaskEngine
      → pipelineBuilders["follow-up-evaluator"] → followUpEvaluatorPipeline().build(bus)
```

## Element 链

```
evaluator-input (source) → evaluator-analyze (transform) → evaluate-finalize (sink)
```

| 顺序 | Element | Kind | 职责 |
|------|---------|------|------|
| 1 | `evaluator-input` | source | 从 session 提取最近 10 条消息生成摘要 |
| 2 | `evaluator-analyze` | transform | 调用 LLM 分类对话健康度 |
| 3 | `evaluate-finalize` | sink | 根据评估结果干预或继续 |

## FlowState

```typescript
type EvaluatorMode = "initial" | "analyzing" | "intervening";

type EvaluatorResult = {
  health: "healthy" | "looping" | "stuck" | "degrading";
  suggestion: string;
  upgradeModel: boolean;
  reason: string;
};

type EvaluatorFlowState = {
  mode: EvaluatorMode;
  task: any;
  session: any;
  recentSummary: string;
  evaluation?: EvaluatorResult;
};
```

## 状态转移

```
initial
  → evaluator-input:  提取消息摘要                    → analyzing
  → evaluator-analyze:  LLM 分类健康度                    → intervening
  → evaluate-finalize: 干预决策                        → PipelineResult
```

## 健康状态 → 行为映射

| health | 行为 |
|--------|------|
| `healthy` | 不做干预，继续调度 conversation |
| `looping` | 写 `session.evaluatorSuggestion`，升级 model 检查 |
| `stuck` | 添加终止消息到 session，停止链式续写 |
| `degrading` | 写 `session.evaluatorSuggestion`，设置 `session.upgradeModel = true` |

### Token 用量双重检查

```
contextTokens > effectiveLimit * 80% && health !== "stuck"
  → orchestrator.scheduleCompress()
```

即使评估为 healthy/degrading，如果 token 用量超过 80% 阈值，也会触发 context-compress 管道。

### upgradeModel 效果

下一轮 conversation 的模型选择：
```
session.upgradeModel === true
  → getResolvedModel("advanced")  // 强制升级模型
  → session.upgradeModel = delete  // 用完即删
```

## Deps

```typescript
{
  session: any;              // → evaluator-input
  task: any;
  apiKey: string;            // → evaluator-analyze
  model: string;             // → evaluator-analyze
  baseUrl?: string;          // → evaluator-analyze
  maxTokens?: number;        // → evaluator-analyze
  orchestrator;              // → evaluate-finalize
  configContextLimit?: number; // → evaluate-finalize
}
```

## 错误处理

| 场景 | 行为 |
|------|------|
| 空消息摘要 | fallback `health: "healthy"` |
| 无 apiKey | fallback `health: "healthy"` |
| LLM 调用失败 | fallback `health: "healthy"` |
| LLM 无 JSON 响应 | fallback `health: "healthy"`，`level: "warn"` |

fallback 策略偏向"不过度干预"——宁可错放也不误杀。

## 文件

```
src/packages/core/src/pipelines/follow-up-evaluator/
  index.ts                          pipeline 定义
  elements/
    types.ts                        EvaluatorFlowState, EvaluatorResult
    index.ts                        barrel export
    evaluator-input.ts
    evaluator-analyze.ts
    evaluate-finalize.ts
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [conversation.md](./conversation.md) | evaluator 如何在 chainAction 链中触发 |
| [context-compress.md](./context-compress.md) | evaluator 触发压缩的阈值条件 |
| [prompts.md](./prompts.md) | evaluator-analyze 使用的提示词 |
