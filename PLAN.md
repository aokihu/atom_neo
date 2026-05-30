# PLAN.md — InternalTaskOrchestrator

> 统一管理所有内部 Task 的创建与入队。实施顺序：Orchestrator → Context Compression。
> 审核通过后按本文档逐项实施。

---

## 1. 定位

当前 pipeline sink 中散落着 `createTaskItem + enqueue` 代码——predict-finalize、evaluate-finalize、finalize 各写各的。新增 pipeline 类型时每次都要重复这段代码。

```
                    InternalTaskOrchestrator
                    ┌──────────────────────────────────────┐
                    │  scheduleConversation(s, ptId)       │
                    │  scheduleEvaluator(s, ptId)          │
                    │  scheduleCompress(s, ptId)           │
                    │  scheduleFollowUp(s, ptId)           │
                    │                                      │
                    │  #queue  ← 唯一入队点                 │
                    └──────────────────────────────────────┘
                              ▲              ▲
                              │              │
                        pipeline sinks   未来 bus events
```

**集中之后**：新增内部 task 类型只需加一个 `scheduleXxx` 方法，不改已有 pipeline。

---

## 2. 接口

```typescript
class InternalTaskOrchestrator {
  constructor(queue: TaskQueue) {}

  // predict-finalize、evaluate-finalize 调用
  scheduleConversation(session: SessionContext, parentTaskId: string, payload?: TaskPayload[]): void

  // finalize 在 chainDepth ≥ 3 时调用
  scheduleEvaluator(session: SessionContext, parentTaskId: string): void

  // evaluate-finalize (token>80%) / compress_context Tool 调用
  scheduleCompress(session: SessionContext, parentTaskId: string): void

  // finalize 在 chainDepth < 3 时调用（普通续写）
  scheduleFollowUp(session: SessionContext, parentTaskId: string): void
}
```

每个方法内部只有两件事：`createTaskItem(...)` + `this.#queue.enqueue(task)`。

---

## 3. pipeline sink 改造

### 3.1 predict-finalize

```diff
- const convTask = createTaskItem({
-   sessionId: ..., pipeline: "conversation", source: INTERNAL,
-   parentTaskId: input.task.id, payload: input.task.payload ?? [],
- });
- this.#queue.enqueue(convTask);
+ this.#orchestrator.scheduleConversation(session, input.task.id, input.task.payload);
```

### 3.2 evaluate-finalize

```diff
- const convTask = createTaskItem({ ... });
- this.#queue.enqueue(convTask);
+ this.#orchestrator.scheduleConversation(session, input.task.parentTaskId ?? input.task.id);
```

### 3.3 finalize — more_tools 分支

```diff
- const chainTask = createTaskItem({
-   sessionId: ..., pipeline: "conversation", source: INTERNAL,
-   parentTaskId: input.task.id, chainId: input.task.chainId, payload: [...],
- });
- this.#buildChainPipeline?.(chainTask.id, ...);
- this.#queue.enqueue(chainTask);
+ this.#orchestrator.scheduleConversation(session, input.task.id, [...]);
```

**注意**：more_tools 的 `buildChainPipeline` 调用也移除了——conversation pipeline 不需要特殊构建，TaskEngine 会通过 pipelineBuilders 自动处理。

### 3.4 finalize — follow_up 分支（普通续写）

```diff
- const chainTask = createTaskItem({ ... payload: "请从上次中断处继续..." ... });
- this.#queue.enqueue(chainTask);
+ this.#orchestrator.scheduleFollowUp(session, input.task.id);
```

### 3.5 finalize — evaluator 触发分支

```diff
- const evalTask = createTaskItem({
-   sessionId: ..., pipeline: "follow-up-evaluator", source: INTERNAL,
-   parentTaskId: ..., payload: [],
- });
- this.#queue.enqueue(evalTask);
+ this.#orchestrator.scheduleEvaluator(session, input.task.parentTaskId ?? input.task.id);
```

### 3.6 finalize 移除的依赖

```diff
- #queue: TaskQueue
- #buildChainPipeline: (...)
- chainDepth?: number

+ #orchestrator: InternalTaskOrchestrator
+ #chainDepth: number
```

---

## 4. 类型变更

```diff
  PredictionPipelineDeps:
-   queue: any;
+   orchestrator: InternalTaskOrchestrator;

  Evaluator deps:
-   queue: TaskQueue;
+   orchestrator: InternalTaskOrchestrator;

  ConversationPipelineDeps:
-   buildChainPipeline?: (...);
-   queue?: any;
+   (移入 orchestrator)
```

---

## 5. 改动清单

| # | 文件 | 操作 |
|---|------|------|
| 1 | `src/packages/core/src/task/internal-task-orchestrator.ts` | **新建** — 唯一实现 |
| 2 | `src/packages/core/src/pipelines/prediction/elements/predict-finalize.ts` | 改 — 替换 createTaskItem+enqueue |
| 3 | `src/packages/core/src/pipelines/follow-up-evaluator/elements/evaluate-finalize.ts` | 改 — 同上 |
| 4 | `src/packages/core/src/pipelines/conversation/elements/finalize.ts` | 改 — 三个分支，移除 queue/buildChainPipeline |
| 5 | `src/packages/core/src/server.ts` | 改 — 构造 orchestrator，注入 pipeline deps |
| 6 | `src/packages/core/src/pipelines/conversation/index.ts` | 改 — ConversationPipelineDeps 移除 buildChainPipeline/queue |
| 7 | `src/packages/core/src/pipelines/prediction/elements/types.ts` | 改 — deps 中 queue → orchestrator |
| 8 | `src/packages/core/src/pipelines/follow-up-evaluator/elements/types.ts` | 改 — 同上 |

---

## 6. 测试

| 场景 | 说明 |
|------|------|
| scheduleConversation | 创建 INTERNAL task，pipeline="conversation"，正确 parentTaskId |
| scheduleEvaluator | 创建 INTERNAL task，pipeline="follow-up-evaluator" |
| scheduleCompress | 创建 INTERNAL task，pipeline="context-compress" |
| scheduleFollowUp | 创建 INTERNAL task，pipeline="conversation"，payload 为续写文本 |
| 现有 148 tests 未破坏 | bun test 全部通过 |

---

## 7. 下一步：Context Compression

Orchestrator 到位后，Context Compression pipeline 可以直接复用 `scheduleCompress` 和 `scheduleConversation`，不需要自己构造 task。

---

## 8. 验收标准

1. [ ] `InternalTaskOrchestrator` 4 个 schedule 方法实现
2. [ ] predict-finalize / evaluate-finalize / finalize 全部替换完成
3. [ ] finalize.ts 不再持有 `queue` 和 `buildChainPipeline`
4. [ ] server.ts 中 `buildChainPipeline` 移除
5. [ ] 现有 148 tests 全部通过
6. [ ] orchestrator 测试通过
