# PLAN.md — Follow-Up Evaluator Pipeline

> 长会话自动运行的质量保障守护管道。
> 审核通过后按本文档逐项实施。

---

## 1. 定位

```
prediction pipeline        → 入口守卫（决定工具集和模型）
conversation pipeline      → 主执行者（干活）
follow-up-evaluator        → 守护进程（监控、纠偏、护航）
```

一句话：**evaluator 管道的职责是保证长会话任务能够在长时间内自动完成，不翻车。**

---

## 2. 触发机制

### 2.1 触发条件

```typescript
// finalize.ts doProcess 改造
if (input.chainAction === "follow_up") {
  if (chainDepth >= MAX_FOLLOW_UP_DEPTH) {
    createEvaluatorTask();   // 硬上限 → 强制介入
  } else if (chainDepth >= 3 && chainDepth % 3 === 0) {
    createEvaluatorTask();   // 每 3 轮周期性巡检
  } else {
    createFollowUpTask();    // 正常续写
  }
}
```

| 条件 | 行为 |
|------|------|
| chainDepth 1-2 | 正常续写，不巡检 |
| chainDepth ≥ 3 且 % 3 === 0 | 每 3 轮触发一次 evaluator |
| chainDepth ≥ MAX_FOLLOW_UP_DEPTH | 强制触发 evaluator（硬上限防护） |

### 2.2 触发时创建什么

```typescript
function createEvaluatorTask() {
  const evalTask = createTaskItem({
    pipeline: "follow-up-evaluator",
    source: TaskSource.INTERNAL,
    parentTaskId: rootTaskId,       // 回到用户初始请求的链
    payload: [],
  });
  queue.enqueue(evalTask);
}
```

与 prediction pipeline 的 predict-finalize 同模式：**不构建 pipeline，只创建 task + 入队**。pipeline 由 TaskEngine 延迟构建。

---

## 3. Pipeline 结构

和 prediction pipeline 同构，确保所有 pipeline 形式统一：

```
evaluator-input (source) → evaluator-analyze (transform) → evaluate-finalize (sink)
```

### 3.1 evaluator-input (source)

**职责**：读取 session 最近 N 轮消息，格式化对话摘要。

**输入**：`{ task, session }`

**输出**：`{ mode: "analyzing", task, session, recentSummary: string }`

**recentSummary 生成**：取 session 最近 6-10 条消息，格式化为：

```
user: {content truncated to 200 chars}
assistant: {content truncated to 200 chars}
```

### 3.2 evaluator-analyze (transform)

**职责**：非流式调用 basic 模型，评估对话健康状态。

**System Prompt**：

```text
You are a conversation health monitor. Analyze the recent conversation and classify:

1. health: "healthy" | "looping" | "stuck" | "degrading"
   - healthy: making genuine progress toward the goal
   - looping: repeating similar outputs or tool calls without progress
   - stuck: unable to proceed (persistent tool failures, dead ends)
   - degrading: output quality declining, losing coherence or focus

2. suggestion: concise advice to help the assistant break out of bad patterns.
   Empty string if healthy.

3. upgradeModel: true if a more powerful model may help resolve the situation.

Reply with JSON: {"health":"...", "suggestion":"...", "upgradeModel":true|false, "reason":"brief"}
```

**实现**：复用 predict-intent 的模式——`generateText` + `temperature: 0` + JSON 解析 + fallback 为 `{ health: "healthy" }`。

### 3.3 evaluate-finalize (sink)

**职责**：根据评估结果决定续写、纠正、或终止。

| health | session 写入 | 创建 conversation task | 用户感知 |
|--------|-------------|----------------------|---------|
| healthy | 无 | 是 | 无感 |
| looping | `session.evaluatorSuggestion = suggestion` | 是 | 无感 |
| degrading | `session.evaluatorSuggestion` + `session.upgradeModel` | 是 | 无感 |
| stuck | 追加终止消息到 session | **否** | **可见** |

```typescript
async doProcess(input: EvaluatorFlowState): Promise<PipelineResult> {
  const { health, suggestion, upgradeModel, reason } = input.evaluation ?? FALLBACK;

  if (health === "stuck") {
    input.session.addMessage({
      role: "assistant",
      content: `(任务过长，已自动中断。${reason})`,
      visible: true,
    });
    return { type: "complete", task: input.task, output: reason };
  }

  if (health !== "healthy") {
    input.session.evaluatorSuggestion = suggestion;
    input.session.upgradeModel = upgradeModel ?? false;
  }

  const convTask = createTaskItem({
    sessionId: input.session.sessionId,
    chatId: input.task.chatId,
    pipeline: "conversation",
    source: TaskSource.INTERNAL,
    parentTaskId: input.task.parentTaskId,
    payload: [{ type: "text", data: "请继续，不要重复已输出的内容。" }],
  });

  this.#queue.enqueue(convTask);
  return { type: "complete", task: input.task, output: `evaluator: health=${health}` };
}
```

### 3.4 类型定义

```typescript
// evaluator elements/types.ts
type EvaluatorMode = "initial" | "analyzing" | "intervening";

type EvaluatorFlowState = {
  mode: EvaluatorMode;
  task: any;
  session: any;
  recentSummary: string;
  evaluation?: {
    health: "healthy" | "looping" | "stuck" | "degrading";
    suggestion: string;
    upgradeModel: boolean;
    reason: string;
  };
};
```

---

## 4. 联动改动

### 4.1 server.ts — pipelineBuilder（新增）

```typescript
"follow-up-evaluator": (task) => {
  const session = sessionStore.get(task.sessionId);
  return followUpEvaluatorPipeline({
    session, task,
    apiKey, model, baseUrl, maxTokens,
    queue: taskQueue,
  }).build(bus);
}
```

### 4.2 server.ts — conversation builder（改）

读取 `session.evaluatorSuggestion`，注入 system prompt：

```typescript
conversation: (task) => {
  const session = sessionStore.get(task.sessionId);
  // ... 现有逻辑
  const suggestion = session.evaluatorSuggestion;
  if (suggestion) {
    delete session.evaluatorSuggestion;
    delete session.upgradeModel;
  }
  // 如果 session.upgradeModel，用 advanced 模型
  const level = session.upgradeModel ? "advanced" : prediction.difficulty;
  // ...
}
```

### 4.3 BUG 修复: check-follow-up.ts

```diff
  if (intent.request === IntentRequestType.FOLLOW_UP) {
    return {
      ...input,
      mode: "ready_to_finalize",
+     chainAction: "follow_up",  // ← 修复：当前缺失
      followUp: { summary: "follow_up", nextPrompt: "", avoidRepeat: "" },
    };
  }
```

### 4.4 finalize.ts 触发逻辑（改）

```diff
- if (input.chainAction && this.#chainDepth >= MAX_FOLLOW_UP_DEPTH) {
-   // 硬停
- }
+ if (input.chainAction === "follow_up") {
+   if (chainDepth >= MAX) createEvaluatorTask();
+   else if (chainDepth >= 3 && chainDepth % 3 === 0) createEvaluatorTask();
+   else createFollowUpTask();
+ }
```

### 4.5 session 扩展

```typescript
// SessionContext 新增字段
evaluatorSuggestion?: string;
upgradeModel?: boolean;
```

---

## 5. 新增文件

```
src/packages/core/src/pipelines/follow-up-evaluator/
├── elements/
│   ├── types.ts
│   ├── evaluator-input.ts
│   ├── evaluator-analyze.ts
│   ├── evaluate-finalize.ts
│   └── index.ts
└── index.ts
```

## 6. 修改文件

| # | 文件 | 操作 |
|---|------|------|
| 1 | `finalize.ts` | 改造触发逻辑（§2） |
| 2 | `check-follow-up.ts` | BUG 修复：FOLLOW_UP 加 chainAction（§4.3） |
| 3 | `server.ts` | pipelineBuilder + conversation builder 读 evaluatorSuggestion（§4.1-4.2） |
| 4 | `session/context.ts` | 加 evaluatorSuggestion / upgradeModel（§4.5） |
| 5 | `pipelines/index.ts` | 导出 evaluator pipeline |

## 7. 预留扩展点

参见 [docs/future-features.md#evaluator-pipeline](docs/future-features.md#evaluator-pipeline)，共 9 项。

## 8. 测试用例

| 场景 | 说明 |
|------|------|
| evaluator-input 生成摘要 | 多轮消息 → 格式化输出 |
| evaluator-input 空 session | 无消息 → 空摘要 |
| evaluator-analyze fallback | 无 apiKey → fallback "healthy" |
| evaluator-analyze 空输入 | 空摘要 → fallback |
| evaluate-finalize healthy | 创建 conversation task |
| evaluate-finalize looping | 写 suggestion + 创建 task |
| evaluate-finalize stuck | 不创建 task，追加终止消息 |

---

## 9. 验收标准

1. [ ] check-follow-up 中 FOLLOW_UP 正确设置 chainAction
2. [ ] chainDepth ≥ 3 且 % 3 === 0 触发 evaluator
3. [ ] chainDepth ≥ 5 强制触发 evaluator
4. [ ] healthy / looping / degrading → 自动续写
5. [ ] stuck → 终止，追加提示到 session
6. [ ] conversation builder 正确注入 evaluatorSuggestion
7. [ ] evaluator 输出 `visible: false`
8. [ ] 现有所测试通过

---

## 10. InternalTaskOrchestrator

> 统一管理所有内部 Task 的创建与入队。详细设计见 [P11-internal-task-orchestrator](docs/milestones/P11-internal-task-orchestrator.md)。

核心变更点：

- `InternalTaskOrchestrator` 集中 `scheduleConversation` / `scheduleEvaluator` / `scheduleCompress` / `scheduleFollowUp` 四个方法
- `predict-finalize` / `evaluate-finalize` / `finalize` 中替换散落的 `createTaskItem + enqueue` 为 orchestrator 调用
- `finalize.ts` 移除 `buildChainPipeline` 和 `queue` 依赖
