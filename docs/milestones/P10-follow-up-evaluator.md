# P10: Follow-Up Evaluator Pipeline — 设计文档

> 长会话自动运行的质量保障守护管道。
> 审核通过后按本计划实施。

---

## 1. 定位

```
prediction pipeline      → 入口守卫（决定工具集和模型）
conversation pipeline    → 主执行者（干活）
follow-up-evaluator      → 守护进程（监控、纠偏、护航）
```

一句话：**evaluator 管道的职责是保证长会话任务能够在长时间内自动完成，不翻车。**

---

## 2. 触发机制

不是只在 `chainDepth >= 5` 时。而是**周期性巡检 + 上限强制**：

```typescript
// finalize.ts — 触发逻辑
const SHOULD_EVALUATE = this.#chainDepth >= 3 && this.#chainDepth % 3 === 0;

if (input.chainAction && this.#chainDepth >= MAX_FOLLOW_UP_DEPTH) {
  // 到达硬上限 → 强制 evaluator 介入
  createEvaluatorTask();
} else if (input.chainAction === "follow_up" && SHOULD_EVALUATE) {
  // 每 3 轮巡检一次
  createEvaluatorTask();
} else if (input.chainAction === "follow_up") {
  // 正常续写
  createFollowUpTask();
}
```

| 条件 | 行为 |
|------|------|
| chainDepth 1-2 | 正常续写，不巡检 |
| chainDepth ≥ 3 且 % 3 === 0 | 每 3 轮触发一次 evaluator |
| chainDepth ≥ MAX | 强制触发 evaluator（硬上限防护） |

---

## 3. Pipeline 结构

和 prediction pipeline 同构，确保所有 pipeline 形式统一：

```
evaluator-input (source) → evaluator-analyze (transform) → evaluate-finalize (sink)
```

### 3.1 evaluator-input (source)

**职责**：读取 session 最近 N 轮消息，格式化对话摘要。

**输入**：PipelineInput `{ task, session }`

**输出**：`{ mode: "analyzing", task, session, recentSummary: string }`

```typescript
type EvaluatorFlowState = {
  mode: "initial" | "analyzing" | "intervening";
  task: any;
  session: any;
  recentSummary: string;          // 最近 N 轮对话的文本摘要
  evaluation?: EvaluatorResult;
};
```

**recentSummary 生成规则**：取 session 最近 6-10 条消息（user + assistant），格式化为：

```
user: {content truncated to 200 chars}
assistant: {content truncated to 200 chars}
...
```

### 3.2 evaluator-analyze (transform)

**职责**：非流式调用 basic 模型，评估对话健康状况。

**System Prompt**：

```text
You are a conversation health monitor. Analyze the recent conversation and classify:

1. health: "healthy" | "looping" | "stuck" | "degrading"
   - healthy: making genuine progress toward the goal
   - looping: repeating similar outputs or tool calls without progress
   - stuck: unable to proceed (persistent tool failures, dead ends)
   - degrading: output quality declining, losing coherence or focus

2. suggestion: concise advice to help the assistant break out of bad patterns.
   Empty string if healthy. Otherwise, a brief guidance (1 sentence).

3. upgradeModel: true if a more powerful model may help resolve the situation.

Reply with JSON: {"health":"...", "suggestion":"...", "upgradeModel":true|false, "reason":"brief explanation"}
```

**实现**：复用 predict-intent 的模式——`generateText` + `temperature: 0` + JSON 解析。

### 3.3 evaluate-finalize (sink)

**职责**：根据评估结果决定下一步——继续、纠正、还是终止。

**行为表**：

| health | 行为 | session 写入 | 创建 conversation task? | 用户感知 |
|--------|------|-------------|----------------------|---------|
| healthy | 重置链深度，续写 | 无（不干预） | 是 | 无感 |
| looping | 注入 suggestion 到 system prompt，续写 | `session.evaluatorSuggestion = suggestion` | 是 | 无感 |
| degrading | 注入 suggestion + 可选升级模型，续写 | `session.evaluatorSuggestion = suggestion; session.upgradeModel = upgradeModel` | 是 | 无感 |
| stuck | 终止，不续写 | 追加终止消息到 session | **否** | **可见**：`(任务过长，已自动中断。{reason})` |

**伪代码**：

```typescript
async doProcess(input: EvaluatorFlowState): Promise<PipelineResult> {
  const { health, suggestion, upgradeModel, reason } = input.evaluation ?? FALLBACK;

  if (health === "stuck") {
    const termMsg = `(任务过长，已自动中断。${reason})`;
    input.session.addMessage({ role: "assistant", content: termMsg, visible: true });
    return { type: "complete", task: input.task, output: termMsg };
  }

  // healthy / looping / degrading → 续写
  if (health !== "healthy") {
    input.session.evaluatorSuggestion = suggestion;
    input.session.upgradeModel = upgradeModel ?? false;
  }

  const convTask = createTaskItem({
    sessionId: input.session.sessionId,
    chatId: input.task.chatId,
    pipeline: "conversation",
    source: TaskSource.INTERNAL,
    parentTaskId: input.task.parentTaskId,   // 回到根 task 的链
    payload: [{ type: "text", data: "请继续，不要重复已输出的内容。" }],
  });

  this.#queue.enqueue(convTask);
  return { type: "complete", task: input.task, output: `evaluator: health=${health}` };
}
```

---

## 4. 依赖的联动改动

### 4.1 server.ts — pipelineBuilder

```typescript
"follow-up-evaluator": (task) => {
  const session = sessionStore.get(task.sessionId);
  return followUpEvaluatorPipeline({
    session,
    task,
    apiKey,        // 分析 LLM 用（basic 模型）
    model,
    baseUrl,
    maxTokens,
    queue: taskQueue,
  }).build(bus);
}
```

### 4.2 server.ts — conversation builder 读 evaluator 上下文

```typescript
conversation: (task) => {
  const session = sessionStore.get(task.sessionId);
  const prediction = session.pendingPrediction ?? FALLBACK;
  const suggestion = session.evaluatorSuggestion;  // ← 新增

  // ... 选 tools + model（如果有 session.upgradeModel，用 advanced 模型）

  return conversationPipeline({
    ...
    systemText: suggestion
      ? systemText + `\n\n[评估建议] ${suggestion}`  // ← 注入到 system prompt
      : systemText,
    ...
  }).build(bus);
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

### 4.4 finalize.ts — 触发逻辑改造

```diff
  if (input.chainAction && this.#chainDepth >= MAX_FOLLOW_UP_DEPTH) {
-   // 硬停，输出终止消息
+   // 创建 evaluator task 保护
+   createEvaluatorTask();
  }
+
+ // 新增：每 3 轮巡检
+ if (input.chainAction === "follow_up" && this.#chainDepth >= 3 && this.#chainDepth % 3 === 0) {
+   createEvaluatorTask();
+ }
```

### 4.5 session.ts — 新增字段

```diff
  export type SessionMessage = {
    ...
    pipeline?: string;
    visible?: boolean;
  };
+
+ // SessionContext 新增属性（可在 SessionContext 上扩展，不污染 SessionMessage）
+ // evaluatorSuggestion: string | undefined
+ // upgradeModel: boolean
```

---

## 5. 新增文件

```
src/packages/core/src/pipelines/follow-up-evaluator/
├── elements/
│   ├── types.ts                  — EvaluatorMode + EvaluatorFlowState
│   ├── evaluator-input.ts        — Source: 读 session 消息摘要
│   ├── evaluator-analyze.ts      — Transform: LLM 分类
│   ├── evaluate-finalize.ts      — Sink: 决定续写/终止
│   └── index.ts                  — 导出 + registerEvaluatorElements()
└── index.ts                       — followUpEvaluatorPipeline(deps) DSL
```

## 6. 预留扩展点

当前不实现，但设计和接口上预留空间：

| 扩展点 | 说明 | 触发时机 | 优先级 |
|--------|------|----------|--------|
| **上下文压缩** | 消息接近 token 上限时，对早期消息做摘要，释放上下文 | chainDepth ≥ 6 或 token usage > 80% | 高 |
| **阶段性 checkpoint** | 将进度摘要写入 memory（traverse_memory 可读取） | 每 5 轮 | 中 |
| **话题漂移检测** | 检测偏离原始任务，偏离时提示用户 | 每次 evaluator | 中 |
| **质量回归检测** | 对比当前输出和早期输出的质量指标 | 每次 evaluator | 低 |
| **任务分解** | 检查是否可拆分成子 task 并行处理 | evaluator 触发时 | 低 |
| **混合模型调度** | 推理子任务用 reasoner，生成子任务用 chat | 根据 upgradeModel 标记 | 低 |
| **成本/延迟统计** | 每轮 token 消耗和延迟汇总 | 长会话后自动生成 | 低 |
| **自动 fallback** | 连续失败后降级模型 | stuck 时 | 中 |

---

## 7. 分析指标（future）

evaluator-input 中预计算（可暂不实现）：

```
recentSummary: 最近 N 轮对话文本

# future: 结构化分析
stats: {
  avgResponseLength: number,        // 平均回复长度
  toolSuccessRate: number,          // tool 调用成功率
  responseSimilarity: number,       // 相邻回复的 Jaccard 相似度
  topicDrift: number,               // 与第一轮的语义距离
  tokenUsage: { total, perRound },  // token 消耗
}
```

结构化指标可辅助 LLM 判断，提高分类准确度。

---

## 8. 与各模块交互图

```
finalize (chainDepth >= 3)
  │
  ├─ createTask({ pipeline: "follow-up-evaluator", source: INTERNAL })
  │  parentTaskId = rootTaskId  (回到用户初始请求的链)
  ▼
TaskEngine → getPipeline → null → pipelineBuilders["follow-up-evaluator"] → build
  │
  ▼
┌─ FollowUpEvaluator Pipeline ──────────────────────────────────────────┐
│  evaluator-input  → 读 session，格式化近轮对话摘要                       │
│  evaluator-analyze → LLM 分类 { health, suggestion, upgradeModel }      │
│  evaluate-finalize →                                                    │
│    healthy:    session 不写入 → createTask("conversation") → enqueue   │
│    looping:    session.evaluatorSuggestion = suggestion                 │
│                → createTask("conversation") → enqueue                  │
│    degrading:  session.evaluatorSuggestion + upgradeModel               │
│                → createTask("conversation") → enqueue                  │
│    stuck:      追加终止消息 → 不创建 task → 链结束                       │
└────────────────────────────────────────────────────────────────────────┘
  │
  ▼ (healthy/looping/degrading)
Task Queue → TaskEngine → getPipeline → null → pipelineBuilders["conversation"]
  → conversation builder 读 session.evaluatorSuggestion
  → 注入 system prompt
  → 续写
```

---

## 9. 改动文件清单

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `pipelines/follow-up-evaluator/elements/types.ts` | 新建 | EvaluatorFlowState 类型 |
| 2 | `pipelines/follow-up-evaluator/elements/evaluator-input.ts` | 新建 | Source：会话摘要 |
| 3 | `pipelines/follow-up-evaluator/elements/evaluator-analyze.ts` | 新建 | Transform：LLM 分类 |
| 4 | `pipelines/follow-up-evaluator/elements/evaluate-finalize.ts` | 新建 | Sink：决定续写/终止 |
| 5 | `pipelines/follow-up-evaluator/elements/index.ts` | 新建 | 导出 + 注册 |
| 6 | `pipelines/follow-up-evaluator/index.ts` | 新建 | DSL 定义 |
| 7 | `finalize.ts` | **修改** | chainDepth ≥ 3 触发 evaluator + 硬上限触发 |
| 8 | `check-follow-up.ts` | **修改** | 修复：FOLLOW_UP 加 chainAction |
| 9 | `server.ts` | **修改** | 注册 + pipelineBuilder + conversation builder 读 evaluatorSuggestion |
| 10 | `session.ts`（类型） | **修改** | SessionContext 加 evaluatorSuggestion / upgradeModel |
| 11 | `pipelines/index.ts` | **修改** | 导出 evaluator pipeline |

---

## 10. 测试用例

### 单元测试

| 场景 | 说明 |
|------|------|
| evaluator-input 生成摘要 | 多轮消息 → 输出格式化摘要 |
| evaluator-input 空 session | 无消息 → 空摘要 |
| evaluator-analyze fallback | 无 apiKey → fallback "healthy" |
| evaluator-analyze 空输入 | 空摘要 → fallback |
| evaluate-finalize healthy | 创建 conversation task |
| evaluate-finalize looping | 写 session.evaluatorSuggestion + 创建 task |
| evaluate-finalize stuck | 不创建 task，输出终止消息 |

### 集成测试

| 场景 | 说明 |
|------|------|
| 3 轮后触发 evaluator | chainDepth=3 → evaluator → healthy → 续写 |
| 硬上限触发 | chainDepth=5 → evaluator → 评估 |
| stuck 终止 | evaluator 判断 stuck → 终止对话，用户看到提示 |
| looping 纠正 | evaluator 判断 looping → 注入 suggestion → 续写 |

---

## 11. 验收标准

1. [ ] BUG 修复: `check-follow-up.ts` 中 FOLLOW_UP 正确设置 `chainAction`
2. [ ] chainDepth ≥ 3 且 % 3 === 0 时触发 evaluator（不硬停）
3. [ ] chainDepth ≥ 5 时强制触发 evaluator
4. [ ] evaluator "healthy" / "looping" / "degrading" → 自动续写
5. [ ] evaluator "stuck" → 终止，用户看到终止提示
6. [ ] conversation builder 正确注入 evaluatorSuggestion
7. [ ] evaluator 输出 `visible: false`，不泄露到用户
8. [ ] 所有现有测试通过
