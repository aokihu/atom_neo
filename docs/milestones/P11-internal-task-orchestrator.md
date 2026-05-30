# InternalTaskOrchestrator — 设计文档

> 统一管理所有内部 Task 的创建与入队，消除 pipeline sink 中散落的 createTaskItem + enqueue 重复代码。
> 对外暴露 schedule 接口，支持直接调用和事件驱动两种触发方式。

---

## 1. 定位

```
                  InternalTaskOrchestrator
                  ┌──────────────────────────────────────────────┐
                  │  scheduleConversation(session, parentId)     │
                  │  scheduleEvaluator(session, parentId)        │
                  │  scheduleCompress(session, parentId)         │
                  │  scheduleFollowUp(session, parentId, depth)  │
                  │                                              │
                  │  #listen(bus, sessionStore)  ← 事件驱动      │
                  │  #enqueue(task)              ← 唯一入队点     │
                  └──────────────────────────────────────────────┘
                            ▲                        ▲
                            │                        │
                      pipeline sinks               bus events
                      (直接调用)                    (发布/监听)
```

**核心职责**：别人告诉我「需要开一个新的内部任务」，我来决定创建什么 Pipeline、构造 TaskItem、入队。调用方不需要知道 pipeline 名字、source、payload 格式。

---

## 2. 接口

```typescript
class InternalTaskOrchestrator {
  constructor(queue: TaskQueue) {}

  // ── 直接调用接口（pipeline sink 使用）──

  /** 创建 conversation pipeline 任务。predict-finalize / evaluate-finalize 调用 */
  scheduleConversation(
    session: SessionContext,
    parentTaskId: string,
    payload?: TaskPayload[],
  ): void

  /** 创建 follow-up-evaluator pipeline 任务。finalize 调用 */
  scheduleEvaluator(
    session: SessionContext,
    parentTaskId: string,
  ): void

  /** 创建 context-compress pipeline 任务。evaluate-finalize / Tool 调用 */
  scheduleCompress(
    session: SessionContext,
    parentTaskId: string,
  ): void

  /** 创建 conversation 续写（follow_up）任务。finalize 调用 */
  scheduleFollowUp(
    session: SessionContext,
    parentTaskId: string,
  ): void

  // ── 事件驱动接口 ──

  /** 监听 bus 事件，自动触发内部 task */
  listen(bus: PipelineEventBus, sessionStore: SessionStore): void
}
```

---

## 3. 方法实现

### 3.1 scheduleConversation

```typescript
scheduleConversation(session: SessionContext, parentTaskId: string, payload?: TaskPayload[]) {
  const task = createTaskItem({
    sessionId: session.sessionId,
    chatId: "chat",
    pipeline: "conversation",
    source: TaskSource.INTERNAL,
    parentTaskId,
    payload: payload ?? [{ type: "text", data: "" }],
  });
  this.#queue.enqueue(task);
}
```

由 `predict-finalize` 和 `evaluate-finalize` 调用。

### 3.2 scheduleEvaluator

```typescript
scheduleEvaluator(session: SessionContext, parentTaskId: string) {
  const task = createTaskItem({
    sessionId: session.sessionId,
    chatId: "chat",
    pipeline: "follow-up-evaluator",
    source: TaskSource.INTERNAL,
    parentTaskId,
    payload: [],
  });
  this.#queue.enqueue(task);
}
```

由 `finalize` 在 chainDepth ≥ 3 时调用。

### 3.3 scheduleCompress

```typescript
scheduleCompress(session: SessionContext, parentTaskId: string) {
  const task = createTaskItem({
    sessionId: session.sessionId,
    chatId: "chat",
    pipeline: "context-compress",
    source: TaskSource.INTERNAL,
    parentTaskId,
    payload: [],
  });
  this.#queue.enqueue(task);
}
```

由 `evaluate-finalize`（token > 80%）或 `compress_context` Tool 调用。

### 3.4 scheduleFollowUp

```typescript
scheduleFollowUp(session: SessionContext, parentTaskId: string) {
  const task = createTaskItem({
    sessionId: session.sessionId,
    chatId: "chat",
    pipeline: "conversation",
    source: TaskSource.INTERNAL,
    parentTaskId,
    payload: [{ type: "text", data: "请从上次中断处继续，不要重复已输出的内容。" }],
  });
  this.#queue.enqueue(task);
}
```

由 `finalize` 在 chainDepth < 3 时调用（普通续写）。

---

## 4. 事件驱动

```typescript
listen(bus: PipelineEventBus, sessionStore: SessionStore): void {
  bus.on("context.near_limit" as any, ({ sessionId }: any) => {
    const session = sessionStore.get(sessionId);
    this.scheduleCompress(session, session.sessionId);
  });
}
```

预留扩展：其他模块通过 `bus.emit("context.near_limit", { sessionId })` 触发压缩。

---

## 5. pipeline sink 改造前后

### predict-finalize

```diff
- const convTask = createTaskItem({
-   sessionId: session.sessionId, chatId: input.task.chatId,
-   pipeline: "conversation", source: TaskSource.INTERNAL,
-   parentTaskId: input.task.id, payload: input.task.payload ?? [],
- });
- this.#queue.enqueue(convTask);
+ this.#orchestrator.scheduleConversation(session, input.task.id, input.task.payload);
```

### evaluate-finalize

```diff
- const convTask = createTaskItem({
-   sessionId: session.sessionId, chatId: input.task.chatId,
-   pipeline: "conversation", source: TaskSource.INTERNAL,
-   parentTaskId: input.task.parentTaskId ?? input.task.id,
-   payload: [{ type: "text", data: "请继续..." }],
- });
- this.#queue.enqueue(convTask);
+ this.#orchestrator.scheduleConversation(session, input.task.parentTaskId ?? input.task.id);
```

### finalize — 三个分支各一行

```diff
- const chainTask = createTaskItem({
-   sessionId: ..., chatId: ..., pipeline: "conversation",
-   source: TaskSource.INTERNAL, parentTaskId: ..., chainId: ..., payload: [...],
- });
- this.#buildChainPipeline?.(...);
- this.#queue.enqueue(chainTask);
+ this.#orchestrator.scheduleConversation(session, input.task.id, [{ type: "text", data: "" }]);

- const chainTask = createTaskItem({ ... payload: "请继续..." ... });
- this.#queue.enqueue(chainTask);
+ this.#orchestrator.scheduleFollowUp(session, input.task.id);

- const evalTask = createTaskItem({
-   sessionId: ..., chatId: ..., pipeline: "follow-up-evaluator",
-   source: TaskSource.INTERNAL, parentTaskId: ..., payload: [],
- });
- this.#queue.enqueue(evalTask);
+ this.#orchestrator.scheduleEvaluator(session, input.task.parentTaskId ?? input.task.id);
```

---

## 6. 改动清单

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `src/packages/core/src/task/internal-task-orchestrator.ts` | **新建** | 唯一实现 |
| 2 | `src/packages/core/src/pipelines/prediction/elements/predict-finalize.ts` | **修改** | 替换 createTaskItem+enqueue |
| 3 | `src/packages/core/src/pipelines/follow-up-evaluator/elements/evaluate-finalize.ts` | **修改** | 替换 createTaskItem+enqueue |
| 4 | `src/packages/core/src/pipelines/conversation/elements/finalize.ts` | **修改** | 三个分支各替换 |
| 5 | `src/packages/core/src/server.ts` | **修改** | 构造 orchestrator，注入到各 pipeline deps |
| 6 | `src/packages/core/src/pipelines/prediction/elements/types.ts` | **修改** | 替换 queue 为 orchestrator |
| 7 | `src/packages/core/src/pipelines/follow-up-evaluator/elements/types.ts` | **修改** | 替换 queue 为 orchestrator |

### 不再需要的文件/代码

- `finalize.ts` 中 `buildChainPipeline` / `#buildChainPipeline` — 不再需要（more_tools 也走 orchestrator）
- `finalize.ts` 中 `#queue` — 不再需要

---

## 7. 涉及的类型变更

```diff
  PredictionPipelineDeps:
-   queue: any;
+   orchestrator: InternalTaskOrchestrator;

  Evaluator deps:
-   queue: TaskQueue;
+   orchestrator: InternalTaskOrchestrator;

  FinalizeElement constructor:
-   queue?: TaskQueue;
-   buildChainPipeline?: (...);
+   orchestrator: InternalTaskOrchestrator;
```

---

## 8. 测试

| 场景 | 说明 |
|------|------|
| scheduleConversation | 创建 INTERNAL task，pipeline="conversation"，正确 parentTaskId |
| scheduleEvaluator | 创建 INTERNAL task，pipeline="follow-up-evaluator" |
| scheduleCompress | 创建 INTERNAL task，pipeline="context-compress" |
| scheduleFollowUp | 创建 INTERNAL task，pipeline="conversation"，payload 为续写文本 |
| enqueue 不重复 | 同一个 task 只入队一次 |

---

## 9. 验收标准

1. [ ] `InternalTaskOrchestrator` 创建并注册
2. [ ] `predict-finalize` / `evaluate-finalize` / `finalize` 全部替换为 orchestrator 调用
3. [ ] `finalize.ts` 移除 `buildChainPipeline` 和 `queue` 依赖
4. [ ] server.ts 注入 orchestrator
5. [ ] 现有 148 tests 全部通过
6. [ ] 新 orchestrator 测试通过
