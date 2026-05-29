# PLAN.md — 用户意图预测 + 会话完成判断

> 定义意图预测管道与正式会话流程的完整实现方案。
> 审核通过后按本文档逐项实施。实施前先提交当前代码。

---

## 1. 总体架构

```
用户输入(text)
  │
  ├─ POST /api/tasks
  │    task.pipeline = "prediction"
  │    task.source = EXTERNAL
  │    task.parentTaskId = task.id  (自引用)
  │    server.ts 只 createTask + enqueue，不碰 pipeline
  ▼
┌─ TaskEngine: #executeTask(task=A) ──────────────────────────────────────┐
│  getPipeline(A) → null                                                   │
│  pipelineBuilders["prediction"](task=A) → build + setPipeline(A)         │
│  执行 Prediction Pipeline · · · · · · · · · · · · · · · · · · · · · · │
└─────────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─ Prediction Pipeline ───────────────────────────────────────────────────┐
│  predict-input → predict-intent → predict-finalize                      │
│                                                                          │
│  predict-finalize (sink):                                                 │
│    ① 读预测结果                                                            │
│    ② session.pendingPrediction = { toolTier, difficulty }                │
│    ③ createTaskItem({ pipeline:"conversation", source:INTERNAL,          │
│         parentTaskId: predictionTask.id })                               │
│    ④ queue.enqueue(convTask)                                              │
│    ⑤ return PipelineResult                                                │
└──────────────────────────────────────────────────────────────────────────┘
  │
  ▼ Task Queue
  │
  ▼
┌─ TaskEngine: #executeTask(task=B) ──────────────────────────────────────┐
│  getPipeline(B) → null                                                   │
│  pipelineBuilders["conversation"](task=B) → build + setPipeline(B)       │
│    └─ 读 session.pendingPrediction → 选 tools + 选 model                 │
│  执行 Conversation Pipeline · · · · · · · · · · · · · · · · · · · · · │
└─────────────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─ Conversation Pipeline ───────────────────────────────────────┐
│  collect-prompts → ... → stream-llm → ... → finalize          │
│  用户看到回复                                                   │
└────────────────────────────────────────────────────────────────┘
```

**核心原则：**

1. **server.ts 只创建 Task 入队，不构建任何 pipeline 对象，不调用 setPipeline。**
2. **所有 pipeline 构建都在 TaskEngine 中延迟完成**，通过 `pipelineBuilders[task.pipeline](task)` 统一入口。
3. **pipelineBuilders 是在 server.ts 闭包中定义的函数映射**，持有 session、tools、model 等业务数据，TaskEngine 只持有函数引用，不接触数据本身。
4. **TaskQueue 是 prediction 和 conversation 之间的唯一中转站。**
5. **`parentTaskId` 永不 null**：根 task 自引用；子 task 指向父 task。

---

## 2. parentTaskId 语义

### 2.1 规则

| Task | parentTaskId | 含义 |
|------|-------------|------|
| 根 task（EXTERNAL，POST /api/tasks 创建） | = taskId | 自己是链路起点 |
| 子 task（INTERNAL，predict-finalize 创建） | 父 task 的 id | 链路真正结束点 |

### 2.2 实现

`task-factory.ts` 一行改动：

```diff
- parentTaskId: params.parentTaskId ?? null,
+ parentTaskId: params.parentTaskId ?? id,
```

不传 `parentTaskId` 则自动设为自身 id。**只有 predict-finalize 显式传了 `parentTaskId`，其他所有调用方都不传，接受默认值。**

---

## 3. Task 流转

### 3.1 POST /api/tasks 处理器（server.ts）

```
① session = sessionStore.get(body.sessionId)
② session.addMessage(userMessage)
③ task = createTaskItem({
     pipeline: "prediction",
     source: EXTERNAL,
     (不传 parentTaskId → 自动 = task.id)
   })
④ taskQueue.enqueue(task)
⑤ return Response(201, { taskId: task.id })

// 不 build pipeline, 不调 setPipeline
```

### 3.2 predict-finalize（prediction pipeline sink）

```
① prediction = input.prediction ?? FALLBACK
② session.pendingPrediction = prediction   // 供 conversation builder 读取
③ convTask = createTaskItem({
     pipeline: "conversation",
     source: INTERNAL,
     parentTaskId: input.task.id,           // ← 显式指向父 task
   })
④ queue.enqueue(convTask)
⑤ return { type: "complete", output: "prediction: ..." }

// 不 build pipeline, 不调 setPipeline
```

### 3.3 TaskEngine（两个 task 统一入口）

```typescript
async #executeTask(task: TaskItem): Promise<any> {
  let pipeline = getPipeline(task.id);

  if (!pipeline && task.pipeline) {
    const builder = this.#pipelineBuilders[task.pipeline];
    if (builder) {
      pipeline = builder(task);
      if (pipeline) setPipeline(task.id, pipeline);
    }
  }

  if (!pipeline) return { type: "complete", task };

  // 执行 pipeline.elements...
}
```

同一个逻辑处理 prediction（`task.pipeline === "prediction"`）和 conversation（`task.pipeline === "conversation"`）。

### 3.4 两个 Task 生命周期

| 次序 | id | parentTaskId | pipeline | source | pipeline 何时构建 |
|------|-----|-------------|----------|--------|------------------|
| 1 | A | A | "prediction" | EXTERNAL | TaskEngine 取 task 时 |
| 2 | B | A | "conversation" | INTERNAL | TaskEngine 取 task 时 |

---

## 4. pipelineBuilders 完整定义

### 4.1 server.ts 注册

```typescript
const pipelineBuilders: Record<string, (task: TaskItem) => Pipeline | undefined> = {

  prediction: (task) => {
    const session = sessionStore.get(task.sessionId);
    return predictionPipeline({
      session,
      task,
      apiKey,        // ← 预测 LLM 用
      model,         // ← 预测 LLM 用
      baseUrl,
      maxTokens,
      buildConversation: undefined as any,   // 过渡期传 undefined，改 predict-finalize 后删
    }).build(bus);
  },

  conversation: (task) => {
    const session = sessionStore.get(task.sessionId);
    const prediction = session.pendingPrediction ?? {
      toolTier: "basic" as const,
      difficulty: "balanced" as const,
    };

    const tools = prediction.toolTier === "full"
      ? [...basic, ...advanced]
      : basic;

    const resolvedModel = runtime.getResolvedModel(prediction.difficulty);

    return conversationPipeline({
      session,
      task,
      apiKey: resolvedModel.apiKey,
      model: resolvedModel.model,
      baseUrl: resolvedModel.baseUrl,
      providerModel: `${resolvedModel.provider}/${resolvedModel.model}`,
      configContextLimit,
      providerOptions: { deepseek: { thinking: { type: resolvedModel.thinking ?? "disabled" } } },
      tools,
      getCompiledPrompt,
      maxTokens,
      memory,
      queue: taskQueue,
      buildChainPipeline,
      chainDepth: 0,
    }).build(bus);
  },
};

const taskEngine = new TaskEngine({ bus, queue: taskQueue, pipelineBuilders });
```

### 4.2 buildConversation 过渡处理

当前 `PredictionPipelineDeps` 还有 `buildConversation` 字段，`route-conversation` 依赖它。实施分两步：

1. 第 1 步（阶段二）：创建 predict-finalize，prediction deps 保留 buildConversation 但 predict-finalize 不用它
2. 第 2 步（收尾）：删 route-conversation 后从 PredictionPipelineDeps 中移除 buildConversation

---

## 5. predict-finalize 规格

**位置**：`src/packages/core/src/pipelines/prediction/elements/predict-finalize.ts`
**操作**：新建，最终替代 `route-conversation.ts`

### 5.1 Element 类型

- Kind: **sink**
- 输入: `PredictionFlowState`
- 输出: `PipelineResult`

### 5.2 依赖

只依赖 `queue`——唯一需要的东西：

```typescript
constructor(params: {
  name: string; kind: string;
  bus: PipelineEventBus<PipelineEventMap>;
  queue: TaskQueue;
})
```

### 5.3 doProcess

```typescript
async doProcess(input: PredictionFlowState): Promise<PipelineResult> {
  const prediction = input.prediction ?? {
    toolTier: "basic",
    difficulty: "balanced",
    reasoning: "fallback",
  };

  input.session.pendingPrediction = prediction;

  const convTask = createTaskItem({
    sessionId: input.session.sessionId,
    chatId: input.task.chatId,
    pipeline: "conversation",
    source: TaskSource.INTERNAL,
    parentTaskId: input.task.id,
    payload: input.task.payload ?? [],
  });

  this.#queue.enqueue(convTask);

  return {
    type: "complete",
    task: input.task,
    output: `prediction: toolTier=${prediction.toolTier}, difficulty=${prediction.difficulty}`,
  };
}
```

### 5.4 PredictionFlowState / PredictionPipelineDeps（最终态）

```diff
  PredictionFlowState:
    (不变)

  PredictionPipelineDeps:
    session: any;
    task: any;
    apiKey: string;            // predict-intent 分类 LLM 用
    model: string;             // predict-intent 分类 LLM 用
    baseUrl?: string;
    maxTokens?: number;
+   queue: TaskQueue;           // predict-finalize 用
-   buildConversation: (...);  // 删除
```

### 5.5 关联改动

| 文件 | 操作 |
|------|------|
| `elements/predict-finalize.ts` | **新建** |
| `elements/route-conversation.ts` | **删除** |
| `elements/types.ts` | 删 `buildConversation`，加 `queue` |
| `elements/index.ts` | 导出 `PredictFinalizeElement`，移除 `RouteConversationElement` |
| `prediction/index.ts` | DSL sink 改为 `"predict-finalize"` |
| `prediction DSL` deps | predictionPipeline(deps) 传入 `queue`，不再传 `buildConversation` |

---

## 6. TUI 链路完成判断

### 6.1 问题

当前 `ws-client.send()` 在收到第一个 `TaskCompleted` 时就 resolve。引入预测管道后，第一个 TaskCompleted 是预测 task，spinner 提前消失。

### 6.2 方案

| 收到的 TaskCompleted | parentTaskId | taskId | 判断 | TUI 行为 |
|---------------------|-------------|--------|------|---------|
| 预测 task A | A（自引用） | A | `parentTaskId === rootTaskId` 但 `taskId === rootTaskId` | **不 resolve** |
| 对话 task B | A | B | `parentTaskId === rootTaskId` 且 `taskId !== rootTaskId` | **resolve** |

判断条件：`parentTaskId === rootTaskId && taskId !== rootTaskId`

### 6.3 server.ts 改动

TaskCompleted 广播 payload 加 `parentTaskId`（**一行**）：

```diff
  payload: {
    taskId: p.task.id,
+   parentTaskId: p.task.parentTaskId,
    output: result.output ?? "",
    tokenUsage: accumulated,
  },
```

### 6.4 ws-client.ts 改动

**send()** — POST 返回的 taskId 作为 rootTaskId：

```typescript
type PendingRequest = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  text: string;
  rootTaskId: string;
};

async send(text: string): Promise<string> {
  const res = await fetch(`${httpUrl}/api/tasks`, { method: "POST", ... });
  const { taskId } = await res.json();
  return new Promise((resolve, reject) => {
    this.#pending.push({ resolve, reject, text: "", rootTaskId: taskId });
  });
}
```

**onmessage TaskCompleted** — 子 task 完成才 resolve：

```typescript
} else if (msg.type === WsMessages.Server.TaskCompleted) {
  const { taskId: completedId, parentTaskId } = msg.payload ?? {};

  for (let i = 0; i < this.#pending.length; i++) {
    const head = this.#pending[i];
    if (parentTaskId === head.rootTaskId && completedId !== head.rootTaskId) {
      const done = this.#pending.splice(i, 1)[0];
      done.resolve(done.text);
      break;
    }
  }

  const tu = msg.payload?.tokenUsage;
  if (tu) this.#onTokenUsage?.(tu.total);
}
```

无 fallback timer：预测失败走 `TaskFailed` → reject。

### 6.5 useChat.ts 改动

删除 `send()` resolve 中移除 spinner 的两行：

```diff
  await client.send(text);
- thinkingIdRef.current = null;
- setMessages(prev => prev.filter(m => m.id !== thinkingId));

  setMessages(prev => {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last.streaming) {
      return prev.map(m => m.id === last.id ? { ...m, streaming: false } : m);
    }
    return prev;
  });
```

spinner 由 `onDelta` 控制（已有逻辑：第一个 delta 到达时移除 thinking）。

### 6.6 ChatView.tsx — 帧率

```diff
- 200
+ 80
```

---

## 7. 实施清单

按顺序，每步后 `bun test` 确认。

### 阶段一：基础设施

| # | 文件 | 操作 |
|---|------|------|
| 1 | `task-factory.ts` | `parentTaskId` 默认值改为 `id`（§2.2） |
| 2 | `task-engine.ts` | 加 `pipelineBuilders` 参数 + 延迟构建逻辑（§3.3） |

### 阶段二：Prediction Pipeline

| # | 文件 | 操作 |
|---|------|------|
| 3 | `elements/predict-finalize.ts` | 新建（§5） |
| 4 | `elements/route-conversation.ts` | 删除 |
| 5 | `elements/types.ts` | 删 `buildConversation`，加 `queue`（§5.4） |
| 6 | `elements/index.ts` | 导出 predict-finalize，移除 route-conversation |
| 7 | `prediction/index.ts` | DSL sink 改为 `"predict-finalize"` |
| 8 | `server.ts` | ①注册 pipelineBuilders（§4.1）②删 `buildConversation` ③TaskCompleted +parentTaskId（§6.3）④POST 处理器只 enqueue 不 build |

### 阶段三：TUI

| # | 文件 | 操作 |
|---|------|------|
| 9 | `ws-client.ts` | send() 按 parentTaskId 判断链路结束（§6.4） |
| 10 | `useChat.ts` | 删两行 spinner 移除（§6.5） |
| 11 | `ChatView.tsx` | 80ms 帧率（§6.6） |

### 阶段四：测试

| # | 文件 | 操作 |
|---|------|------|
| 12 | `prediction.test.ts` | 更新测试（route-conversation → predict-finalize） |
| 13 | `task-engine.test.ts` | 新增：pipelineBuilders 延迟构建 |

### 阶段五：验证

| # | 检查项 |
|---|--------|
| 14 | `bun test` 全部通过 |
| 15 | 手动 E2E：天气查询 → spinner 持续到文本出现 → 会话完成 |

---

## 8. 时序图

```
 用户       TUI(client)          server             TaskEngine           Pipeline           LLM
  │             │                    │                   │                    │                │
  ├─输入文本───→│                    │                   │                    │                │
  │             ├─POST /api/tasks───→│                   │                    │                │
  │  [spinner]  │  → { taskId: A }   │                   │                    │                │
  │             │                    ├─enqueue(task=A)──→│                    │                │
  │             │                    │  ■ 不 build       │                    │                │
  │             │                    │  ■ 不 setPipeline │                    │                │
  │             │                    │                   ├─getPipeline(A)→null│                │
  │             │                    │                   ├─pipelineBuilders   │                │
  │             │                    │                   │  ["prediction"](A) │                │
  │             │                    │                   │  → buildPipeline   │                │
  │             │                    │                   │  → setPipeline(A)  │                │
  │             │                    │                   ├─getPipeline(A)────→│                │
  │             │                    │                   │                    ├─predict-input │
  │             │                    │                   │                    ├─predict-intent→│generateText
  │             │                    │                   │                    ├─predict-finalize
  │             │                    │                   │                    │  ├─session.prediction
  │             │                    │                   │                    │  ├─createTask(B)
  │             │                    │                   │                    │  └─enqueue(B)  │
  │             │←─TaskCompleted(A)──┤                   │←────────────────────┤                │
  │             │  parent=A,         │                   │  Completed(A)       │                │
  │             │  taskId=A →不resolve                  │                    │                │
  │  [spinner]  │                    │                   ├─getPipeline(B)→null│                │
  │             │                    │                   ├─pipelineBuilders   │                │
  │             │                    │                   │  ["conversation"](B)│               │
  │             │                    │                   │  → 读session.prediction              │
  │             │                    │                   │  → 选tools+选model │                │
  │             │                    │                   │  → buildPipeline   │                │
  │             │                    │                   │  → setPipeline(B)  │                │
  │             │                    │                   ├─getPipeline(B)────→│                │
  │             │                    │                   │                    ├─collect-prompts
  │             │                    │                   │                    ├─...            │
  │             │                    │                   │                    ├─stream-llm────→│streamText
  │             │←─TransportDelta───┤←───────────────────┤←───────────────────┤←───────────────│text chunks
  │  [文字显示]  │                    │                   │                    │                │
  │  [spinner隐藏]│                   │                   │                    ├─parse-intents  │
  │             │                    │                   │                    ├─check-follow-up│
  │             │                    │                   │                    ├─finalize       │
  │             │←─TaskCompleted(B)──┤                   │←────────────────────┤                │
  │             │  parent=A,         │                   │  Completed(B)       │                │
  │             │  taskId=B → resolve send()            │                    │                │
  │  [streaming=false]               │                   │                    │                │
  │  [会话完成]    │                    │                   │                    │                │
```

### 时序说明

| 时刻 | 事件 | pipeline 状态 |
|------|------|-------------|
| T=0 | POST → server 创建 task=A，入队 | task=A 无 pipeline |
| T=0+ | TaskEngine 取 task=A → `getPipeline(A)=null` → `pipelineBuilders["prediction"](A)` → build + setPipeline | task=A 有 prediction pipeline |
| T=1~3s | Prediction pipeline 执行 | — |
| T=3s | predict-finalize 创建 task=B，入队 | task=B 无 pipeline |
| T=3s | Prediction 返回 → TaskCompleted(A) 广播 | — |
| T=3s+ | TUI 收到 TaskCompleted(A)：`parentTaskId=A, taskId=A` → **不 resolve** | — |
| T=3s+ | TaskEngine 取 task=B → `getPipeline(B)=null` → `pipelineBuilders["conversation"](B)` → 读 session.prediction → 选 tools+model → build + setPipeline | task=B 有 conversation pipeline |
| T=4s+ | Conversation pipeline 开始流式输出 | — |
| T=4s+ | TransportDelta → spinner 隐藏，文字显示 | — |
| T=7s+ | Conversation 完成 → TaskCompleted(B) 广播 | — |
| T=7s+ | TUI 收到 TaskCompleted(B)：`parentTaskId=A, taskId=B≠A` → **resolve** | 会话完成 |
