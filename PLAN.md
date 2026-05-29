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
  │    task.parentTaskId = task.id  (自引用，父 Task 即本身)
  │    server.ts 构建 predictionPipeline → setPipeline(task.id, pipeline) → enqueue
  ▼
┌─ Prediction Pipeline ───────────────────────────────────────────────────┐
│  predict-input → predict-intent → predict-finalize                      │
│                                                                          │
│  predict-finalize 内部 (sink element):                                    │
│    ① 读预测结果 { toolTier, difficulty }                                  │
│    ② 写入 session.predictToolTier / session.predictDifficulty            │
│    ③ createTaskItem({ pipeline:"conversation", source:INTERNAL,          │
│         parentTaskId: predictionTask.id }) → enqueue                     │
│    ④ return PipelineResult (预测 task 完成)                                │
└──────────────────────────────────────────────────────────────────────────┘
                     │
                     ▼ Task Queue（唯一中转站）
                     │
                     ▼
┌─ TaskEngine 延迟构建 Pipeline ──────────────────────────────────────────┐
│  #executeTask(task):                                                     │
│    pipeline = getPipeline(task.id)                                       │
│    if (!pipeline && task.pipeline)                                       │
│      pipeline = pipelineBuilders[task.pipeline](task)                    │
│      setPipeline(task.id, pipeline)                                      │
│    // 执行 pipeline.elements...                                           │
└──────────────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─ Conversation Pipeline ───────────────────────────────────────┐
│  collect-prompts → ... → stream-llm(full/partial tools)       │
│       → parse-intents → check-follow-up → finalize             │
│  用户看到回复                                                   │
└────────────────────────────────────────────────────────────────┘
```

**核心原则：**

- **TaskEngine 持有 `pipelineBuilders`**，按 task 的 pipeline 字段延迟构建。不接触 session 等业务数据，只调用闭包函数。
- **调用方只创建 task + 入队**，不碰 pipeline 构建逻辑。
- **TaskQueue** 是 prediction 和 conversation 之间的唯一中转站。
- **`parentTaskId` 永不 null**：根 task 自引用 `parentTaskId = taskId`；子 task 指向父 task。

---

## 2. parentTaskId 语义

### 2.1 规则

| Task | parentTaskId | 含义 |
|------|-------------|------|
| 根 task（EXTERNAL，用户直接请求） | `task.id`（自己） | 没有上级，自己是链路起点 |
| 子 task（INTERNAL，predict-finalize 创建） | 父 task 的 id | 链路中的真正结束点 |

### 2.2 实现

修改 `task-factory.ts` 中的默认值（一行）：

```diff
export function createTaskItem(params: { ... parentTaskId?: string | null ... }): TaskItem {
  const id = generateId("task");
  return {
    // ...
-   parentTaskId: params.parentTaskId ?? null,
+   parentTaskId: params.parentTaskId ?? id,
  };
}
```

无论何处调用 `createTaskItem`，不传 `parentTaskId` 时自动设为自身 id。

---

## 3. TaskEngine 延迟构建 Pipeline

### 3.1 当前问题

pipeline 构建逻辑分散在多处（server.ts、predict-finalize、finalize），每处都要知道 tools/model/session 的选择规则。

### 3.2 方案

TaskEngine 增加 `pipelineBuilders` 参数：

```typescript
type PipelineBuilder = (task: TaskItem) => Pipeline | undefined;

export class TaskEngine {
  #pipelineBuilders: Record<string, PipelineBuilder>;

  constructor(params: {
    bus: PipelineEventBus<CoreEventMap>;
    queue: TaskQueue;
    pipelineBuilders: Record<string, PipelineBuilder>;  // ← 新增
    timeoutMs?: number;
  }) { ... }

  async #executeTask(task: TaskItem): Promise<any> {
    let pipeline = getPipeline(task.id);

    // 延迟构建：pipelineMap 中没有，按 task.pipeline 字段匹配 builder
    if (!pipeline && task.pipeline) {
      const builder = this.#pipelineBuilders[task.pipeline];
      if (builder) {
        pipeline = builder(task);
        if (pipeline) setPipeline(task.id, pipeline);
      }
    }

    if (!pipeline) return { type: "complete", task };

    // ... 执行 pipeline.elements ...
  }
}
```

### 3.3 pipelineBuilders 注册（server.ts）

所有业务上下文（session、tools、model、apiKey）都在 server.ts 的闭包中，通过 builder 函数注入：

```typescript
// server.ts — 注册 pipeline builders
const pipelineBuilders: Record<string, (task: TaskItem) => Pipeline | undefined> = {
  prediction: (task) => {
    const session = sessionStore.get(task.sessionId);
    return predictionPipeline({
      session,
      task,
      apiKey, model, baseUrl, maxTokens,
      // ...
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

### 3.4 效果

| 文件 | 之前（提前 setPipeline） | 之后（延迟构建） |
|------|------------------------|----------------|
| `server.ts` | 手动 build 并 setPipeline，代码分散 | 只在 pipelineBuilders 中集中定义 |
| `predict-finalize.ts` | 手动 build conversation pipeline + setPipeline | **只创建 task + 入队**，不再碰 pipeline |
| `buildConversation` | 独立函数，~40行 | **删除** |
| `route-conversation.ts` | 带 buildConversation 回调 | **删除** |

---

## 4. predict-finalize 规格

**位置**：`src/packages/core/src/pipelines/prediction/elements/predict-finalize.ts`
**操作**：新建，**替代** `route-conversation.ts`

### 4.1 Element 类型

- Kind: **sink**
- 输入: `PredictionFlowState`
- 输出: `PipelineResult`

### 4.2 依赖

大幅精简，不再需要 tools/model/apiKey/...，只需要 `queue`：

```typescript
constructor(params: {
  name: string; kind: string;
  bus: PipelineEventBus<PipelineEventMap>;
  queue: TaskQueue;
})
```

### 4.3 doProcess

```typescript
async doProcess(input: PredictionFlowState): Promise<PipelineResult> {
  const prediction = input.prediction ?? {
    toolTier: "basic",
    difficulty: "balanced",
    reasoning: "fallback",
  };

  const session = input.session;
  session.pendingPrediction = prediction;

  const convTask = createTaskItem({
    sessionId: session.sessionId,
    chatId: input.task.chatId,
    pipeline: "conversation",
    source: TaskSource.INTERNAL,
    parentTaskId: input.task.id,
    payload: input.task.payload ?? [],
  });

  this.#queue.enqueue(convTask);
  // 不再 setPipeline — 由 TaskEngine 延迟构建

  return {
    type: "complete",
    task: input.task,
    output: `prediction: toolTier=${prediction.toolTier}, difficulty=${prediction.difficulty}`,
  };
}
```

### 4.4 PredictionPipelineDeps 变更

```diff
  PredictionPipelineDeps:
-   buildConversation: (session, prediction) => void
-   sandbox, apiKey, model, baseUrl, providerModel, ...
-   basicTools, advancedTools, getCompiledPrompt, ...
+   queue: TaskQueue
+   (其余由 pipelineBuilders["prediction"] 闭包捕获)
```

### 4.5 关联改动

| 文件 | 操作 |
|------|------|
| `elements/route-conversation.ts` | **删除** |
| `elements/predict-finalize.ts` | **新建** |
| `elements/types.ts` | 更新 `PredictionPipelineDeps`（删 buildConversation） |
| `elements/index.ts` | 导出 `PredictFinalizeElement`，移除 `RouteConversationElement` |
| `prediction/index.ts` | DSL sink 从 `route-conversation` 改为 `predict-finalize` |
| `server.ts` | ①删 `buildConversation` ②注册 pipelineBuilders ③TaskCompleted payload +parentTaskId |
| `prediction.test.ts` | 更新测试 |

---

## 5. TUI 链路完成判断

### 5.1 问题

引入 Prediction Pipeline 后每个用户请求产生两个 Task。`ws-client.send()` 收到第一个 TaskCompleted（预测完成）就 resolve，导致 spinner 提前消失。

### 5.2 方案

按 `parentTaskId` 区分：只有子 task（产生文本的 task）完成时才 resolve。

| 收到的 TaskCompleted | parentTaskId | 含义 | TUI 行为 |
|---------------------|-------------|------|---------|
| 预测 task (id=A) | A（自引用） | 预测完成 | **不 resolve** |
| 对话 task (id=B) | A（≠B） | 会话结束 | **resolve** |

判断条件：`parentTaskId === rootTaskId && taskId !== rootTaskId`

### 5.3 server.ts 改动

TaskCompleted 广播 payload 加 `parentTaskId`（一行）：

```diff
  payload: {
    taskId: p.task.id,
+   parentTaskId: p.task.parentTaskId,
    output: result.output ?? "",
    tokenUsage: accumulated,
  },
```

### 5.4 ws-client.ts 改动

**send()** — 获取 rootTaskId：

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
    // 子 task 完成：parentTaskId 指向 rootTaskId 且不是 rootTask 自身
    if (parentTaskId && parentTaskId === head.rootTaskId && completedId !== head.rootTaskId) {
      const done = this.#pending.splice(i, 1)[0];
      done.resolve(done.text);
      break;
    }
  }

  const tu = msg.payload?.tokenUsage;
  if (tu) this.#onTokenUsage?.(tu.total);
}
```

**无需 fallback。** 预测 pipeline 一定产生子 task。预测失败走 `TaskFailed` → reject。

### 5.5 useChat.ts 改动

删除 `send()` resolve 中移除 spinner 的两行。spinner 由 `onDelta` 控制（已有逻辑）。

```diff
  await client.send(text);
- thinkingIdRef.current = null;
- setMessages(prev => prev.filter(m => m.id !== thinkingId));

  // 保留 streaming: false 收尾
  setMessages(prev => { ... });
```

### 5.6 ChatView.tsx — 帧率

```diff
- 200
+ 80
```

---

## 6. 实施清单

按顺序，每步后 `bun test` 确认。

### 阶段一：parentTaskId + TaskEngine

| # | 文件 | 操作 |
|---|------|------|
| 1 | `task-factory.ts` | `parentTaskId` 默认值改为 `id`（自引用） |
| 2 | `task-engine.ts` | 加 `pipelineBuilders` 参数（§3.2） |

### 阶段二：Prediction Pipeline

| # | 文件 | 操作 |
|---|------|------|
| 3 | `elements/predict-finalize.ts` | 新建（精简版 sink，§4） |
| 4 | `elements/route-conversation.ts` | 删除 |
| 5 | `elements/types.ts` | 更新 deps |
| 6 | `elements/index.ts` | 导出 predict-finalize |
| 7 | `prediction/index.ts` | DSL sink 改名 |
| 8 | `server.ts` | ①删 buildConversation ②注册 pipelineBuilders ③TaskCompleted +parentTaskId |

### 阶段三：TUI

| # | 文件 | 操作 |
|---|------|------|
| 9 | `ws-client.ts` | send() 按 parentTaskId 判断链路结束（§5.4） |
| 10 | `useChat.ts` | 删两行 spinner 移除（§5.5） |
| 11 | `ChatView.tsx` | 80ms 帧率（§5.6） |

### 阶段四：测试

| # | 文件 | 操作 |
|---|------|------|
| 12 | `prediction.test.ts` | 更新测试用例 |
| 13 | `task-engine.test.ts` | 测试 pipelineBuilders 延迟构建 |

### 阶段五：验证

| # | 检查项 |
|---|--------|
| 14 | `bun test` 全部通过 |
| 15 | `bun run --bun tsc --noEmit` 无新增类型错误 |
| 16 | E2E 手动验证：发送天气查询 → spinner 持续 → 文本出现 → 会话完成 |

---

## 7. 时序图

```
 用户       TUI(client)          server             TaskEngine           Pipeline           LLM
  │             │                    │                   │                    │                │
  ├─输入文本───→│                    │                   │                    │                │
  │             ├─POST /api/tasks───→│                   │                    │                │
  │             │  (taskId=A,        │                   │                    │                │
  │             │   pipeline=pred,   │                   │                    │                │
  │             │   parent=A)        │                   │                    │                │
  │  [spinner]  │                    ├─enqueue(task)─────→│                    │                │
  │             │                    │  setPipeline(A,    │                    │                │
  │             │                    │   predictPipeline) │                    │                │
  │             │                    │                    ├─getPipeline(A)────→│                │
  │             │                    │                    │                    ├─predict-input │
  │             │                    │                    │                    ├─predict-intent→│generateText
  │             │                    │                    │                    ├─predict-finalize
  │             │                    │                    │                    │  ├─写session   │
  │             │                    │                    │                    │  ├─createTask(B)
  │             │                    │                    │                    │  └─enqueue(B)  │
  │             │←─TaskCompleted(A)──┤                    │←────────────────────┤                │
  │             │  parent=A,         │                    │  Completed(A)       │                │
  │             │  taskId=A(A=A)→不resolve               │                    │                │
  │  [spinner]  │                    │                    ├─getPipeline(B)→null│                │
  │             │                    │                    ├─pipelineBuilders    │                │
  │             │                    │                    │  ["conversation"]   │                │
  │             │                    │                    │  → build+setPipeline│                │
  │             │                    │                    ├─getPipeline(B)────→│                │
  │             │                    │                    │                    ├─collect-prompts
  │             │                    │                    │                    ├─...            │
  │             │                    │                    │                    ├─stream-llm────→│streamText
  │             │←─TransportDelta───┤←───────────────────┤←───────────────────┤←───────────────│text chunks
  │  [文字显示]  │                    │                    │                    │                │
  │  [spinner隐藏]│                   │                    │                    ├─parse-intents  │
  │             │                    │                    │                    ├─check-follow-up│
  │             │                    │                    │                    ├─finalize       │
  │             │←─TaskCompleted(B)──┤                    │←────────────────────┤                │
  │             │  parent=A,         │                    │  Completed(B)       │                │
  │             │  taskId=B(A≠B)→ resolve send()         │                    │                │
  │  [streaming=false]               │                    │                    │                │
  │  [会话完成]    │                    │                    │                    │                │
```
