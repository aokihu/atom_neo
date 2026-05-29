# PLAN.md — 用户意图预测管道 + 会话完成判断

> 本文件定义意图预测管道与正式会话流程的完整实现方案。后续开发必须严格按照本文档执行。  
> 审核通过后方可实施。

---

## 目录

1. [总体架构](#1-总体架构)
2. [Task 流转与 pipeline 选择](#2-task-流转与-pipeline-选择)
3. [predict-finalize 详细设计](#3-predict-finalize-详细设计)
4. [TUI 链路完成判断](#4-tui-链路完成判断)
5. [实施清单](#5-实施清单)
6. [时序图](#6-时序图)

---

## 1. 总体架构

```
用户输入(text)
  │
  ├─ POST /api/tasks ──────────────────────────────────────────┐
  │    task.pipeline = "prediction"                              │
  │    setPipeline(task.id, pipeline)                          │
  ▼                                                              │
┌─────────────────────────────────┐                             │
│  Prediction Pipeline             │                             │
│  predict-input → predict-intent  │                             │
│    → predict-finalize            │                             │
│                                  │                             │
│  predict-finalize 内部:          │                             │
│  ① 预测结果写入 session          │                             │
│  ② 构建 conversationPipeline     │                             │
│  ③ createTaskItem({              │                             │
│       pipeline: "conversation",   │                             │
│       source: INTERNAL,           │                             │
│       parentTaskId: predictionId  │                             │
│     })                            │                             │
│  ④ setPipeline + queue.enqueue   │                             │
└──────┬──────────────────────────┘                             │
       │                                                         │
       ▼                                                         │
  Task Queue ────→ TaskEngine                                   │
       │              │                                          │
       │          getPipeline(taskId) ≠ null                     │
       │              │  (predict-finalize 已 setPipeline)       │
       │              ▼                                          │
       │          执行 conversation pipeline                     │
       │              │                                          │
       │          TaskCompleted                                  │
       │              │                                          │
       │              ▼                                          │
       └──── TUI 收到 TaskCompleted ─────────────────────────────┘
                 │ parentTaskId === rootTaskId
                 │ → markLastStreaming(false)
                 ▼
              会话完成
```

**核心原则：**

- TaskEngine 只做一件事：`getPipeline(taskId)` 拿到 pipeline → 执行。**TaskEngine 零改动。**
- pipeline 对象的创建职责属于 predict-finalize（由它 build 并 setPipeline）。
- TaskQueue 是 prediction 和 conversation 之间的唯一中转站。
- TUI 按 `parentTaskId` 判断用户提交的会话是否正式完成。

---

## 2. Task 流转与 pipeline 选择

### 2.1 用户输入产生的 Task

```
POST /api/tasks
  body: { sessionId: "s1", chatId: "c1", data: { text: "帮我查天气" } }

  server.ts 处理器:
    task = createTaskItem({
      sessionId: body.sessionId,
      chatId: body.chatId,
      pipeline: "prediction",             // ← 用户消息一律走 prediction
      source: TaskSource.EXTERNAL,
      payload: [{ type: "text", data: body.data.text }],
    })

    pipeline = predictionPipeline({...}).build(bus)
    setPipeline(task.id, pipeline)
    taskQueue.enqueue(task)
```

### 2.2 Prediction Pipeline 产生的 Task

```
predict-finalize (sink) 内部:

  const convTask = createTaskItem({
    sessionId: predictionTask.sessionId,
    chatId: predictionTask.chatId,
    pipeline: "conversation",             // ← 会话 task 固定走 conversation
    source: TaskSource.INTERNAL,
    parentTaskId: predictionTask.id,      // ← 链路：子 task 指向父 task
    payload: predictionTask.payload,      // ← 复用用户原始输入
  });

  // 构建 conversation pipeline 对象并注册
  pipeline = conversationPipeline({ tools, model, ... }).build(bus);
  setPipeline(convTask.id, pipeline);

  taskQueue.enqueue(convTask);
```

### 2.3 TaskEngine 获取 Pipeline

```
#executeTask(task):
  pipeline = getPipeline(task.id)
  if (!pipeline) return { type: "complete", task }   // 没注册 → 跳过
  // 执行 pipeline.elements...
```

**保证**：`getPipeline` 一定能拿到 pipeline，因为：
- 用户产生的 task：`server.ts` 在入队前做了 `setPipeline`
- predict-finalize 产生的 task：`predict-finalize` 在入队前做了 `setPipeline`
- REQUEST_MORE_TOOLS 链：`buildChainPipeline` 在入队前做了 `setPipeline`

### 2.4 pipeline 字段的值含义

| pipeline 字段值 | 含义 | 谁创建 | pipeline 何时构建 |
|----------------|------|--------|------------------|
| `"prediction"` | 意图预测 | server.ts POST 处理器 | POST 时就构建并 setPipeline |
| `"conversation"` | 正式会话 | predict-finalize | predict-finalize 内部构建并 setPipeline |
| `"follow-up"` | 续写任务 | 暂未启用，stub | — |

`task.pipeline` 字段是字符串标识，**不是**存储真正的 Pipeline 对象。真正的 Pipeline 对象通过 `setPipeline(taskId, pipeline)` 注册到 `pipelineMap`（`api/tasks.ts` 中的 Map）。

---

## 3. predict-finalize 详细设计

### 3.1 位置

```
src/packages/core/src/pipelines/prediction/elements/predict-finalize.ts
```

**替换** 现有的 `route-conversation.ts`。

### 3.2 Element 类型

- Kind: **sink**
- 输入: `PredictionFlowState`
- 输出: `PipelineResult`

### 3.3 依赖（Constructor 参数）

```typescript
constructor(params: {
  name: string;
  kind: string;
  bus: PipelineEventBus<PipelineEventMap>;

  // conversationPipeline 需要的全部参数
  sandbox: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  providerModel: string;
  configContextLimit?: number;
  providerOptions: Record<string, Record<string, unknown>>;
  basicTools: ToolDefinition[];
  advancedTools: ToolDefinition[];
  getCompiledPrompt: () => string;
  maxTokens: number;
  memory: any;
  queue: TaskQueue;

  buildChainPipeline: (chainTaskId, sessionId, chatId, chainDepth) => void;
})
```

### 3.4 doProcess 逻辑

```typescript
async doProcess(input: PredictionFlowState): Promise<PipelineResult> {
  // ① 获取预测结果，fallback
  const prediction = input.prediction ?? {
    toolTier: "basic",
    difficulty: "balanced",
    reasoning: "fallback",
  };

  // ② 写入 session，供后续 conversation 的 element 读取（如 collect-context）
  const session = input.session;
  session.pendingPrediction = prediction;

  // ③ 根据预测结果选择工具和模型
  const tools = prediction.toolTier === "full"
    ? [...this.#basicTools, ...this.#advancedTools]
    : this.#basicTools;

  const resolvedModel = this.#resolveModel(prediction.difficulty);

  // ④ 构建 conversation pipeline
  const convPipeline = conversationPipeline({
    session,
    task: { id: "pending", sessionId: session.sessionId, chatId: input.task.chatId,
           sandbox: this.#sandbox, payload: input.task.payload ?? [] },
    apiKey: resolvedModel.apiKey,
    model: resolvedModel.model,
    baseUrl: resolvedModel.baseUrl,
    providerModel: `${resolvedModel.provider}/${resolvedModel.model}`,
    configContextLimit: this.#configContextLimit,
    providerOptions: { deepseek: { thinking: { type: resolvedModel.thinking ?? "disabled" } } },
    tools,
    getCompiledPrompt: this.#getCompiledPrompt,
    maxTokens: this.#maxTokens,
    memory: this.#memory,
    queue: this.#queue,
    buildChainPipeline: this.#buildChainPipeline,
    chainDepth: 0,
  }).build(this.bus);

  // ⑤ 创建 conversation task 并入队
  const convTask = createTaskItem({
    sessionId: session.sessionId,
    chatId: input.task.chatId,
    pipeline: "conversation",
    source: TaskSource.INTERNAL,
    parentTaskId: input.task.id ?? null,
    payload: input.task.payload ?? [],
  });

  setPipeline(convTask.id, convPipeline);
  this.#queue.enqueue(convTask);

  // ⑥ 返回预测完成结果
  return {
    type: "complete",
    task: input.task,
    output: `prediction: toolTier=${prediction.toolTier}, difficulty=${prediction.difficulty}`,
  };
}
```

### 3.5 PredictionPipelineDeps 变更

```diff
  export type PredictionPipelineDeps = {
    session: any;
    task: any;
    apiKey: string;
    model: string;
    baseUrl?: string;
    maxTokens?: number;
-   buildConversation: (session: any, prediction: IntentPredictionResult) => void;
+   sandbox: string;
+   tools: { basic: ToolDefinition[]; advanced: ToolDefinition[] };
+   providerModel: string;
+   configContextLimit?: number;
+   providerOptions: Record<string, Record<string, unknown>>;
+   getCompiledPrompt: () => string;
+   memory: any;
+   queue: any;
+   buildChainPipeline: (...args: any[]) => void;
  };
```

### 3.6 删除

- `route-conversation.ts` — 删除文件
- `types.ts` 中 `buildConversation` 依赖 — 删除
- `server.ts` 中 `buildConversation` 函数 — 删除整段（约40行）

---

## 4. TUI 链路完成判断

### 4.1 问题

引入 Prediction Pipeline 后，每个用户请求产生**两个** Task：

| 序号 | Task | parentTaskId | 说明 |
|------|------|-------------|------|
| 1 | prediction (id=A) | null | 预测管道 |
| 2 | conversation (id=B) | A | 正式会话 |

当前 ws-client 的 `send()` 在收到**第一个** `TaskCompleted`（预测完成）时就 resolve，导致：
- spinner 提前消失
- 标记 `streaming: false` 过早

### 4.2 解决

TUI 端不关心预测 Task，只关心 Conversation Task。通过 `parentTaskId` 区分：

```
TaskCompleted.payload = {
  taskId: string,
  parentTaskId: string | null,    // ← 新增字段
  output: string,
  tokenUsage: number,
}
```

**判断逻辑：**

| 收到的 TaskCompleted | parentTaskId | 含义 | TUI 行为 |
|---------------------|-------------|------|---------|
| 预测 task (id=A) | null | 预测完成，会话还未开始 | **不 resolve**，继续等待 |
| 会话 task (id=B) | A (等于 rootTaskId) | 正式会话完成 | **resolve**，标记 streaming=false |

### 4.3 server.ts 改动

在 `BusEvents.Task.Completed` 处理器中，payload 增加 `parentTaskId`：

```diff
  broadcaster.broadcastToSession(sid, {
    type: WsMessages.Server.TaskCompleted,
    ts: Date.now(), seq: 0,
-   payload: { taskId: p.task.id, output: result.output ?? "", tokenUsage: accumulated },
+   payload: { taskId: p.task.id, parentTaskId: p.task.parentTaskId, output: result.output ?? "", tokenUsage: accumulated },
  });
```

**一行改动。** `p.task.parentTaskId` 是 `TaskItem` 已存在的字段。

### 4.4 ws-client.ts 改动

`send()` 方法改造：

```typescript
// 新增 pending 类型
type PendingRequest = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  text: string;
  rootTaskId: string;
};

async send(text: string): Promise<string> {
  const httpUrl = this.#url.replace(/^ws/, "http");
  const res = await fetch(`${httpUrl}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: this.#sessionId, chatId: this.#chatId, data: { text },
    }),
  });
  const { taskId } = await res.json();    // ← 获取 rootTaskId（预测 task 的 ID）

  return new Promise<string>((resolve, reject) => {
    this.#pending.push({ resolve, reject, text: "", rootTaskId: taskId });
  });
}
```

`onmessage` 中 `TaskCompleted` 处理改造：

```typescript
} else if (msg.type === WsMessages.Server.TaskCompleted) {
  const { taskId: completedId, parentTaskId } = msg.payload ?? {};

  for (let i = 0; i < this.#pending.length; i++) {
    const head = this.#pending[i];

    // 子 task 完成：parentTaskId 指向 rootTaskId → 链路真正结束
    if (parentTaskId && parentTaskId === head.rootTaskId) {
      const done = this.#pending.splice(i, 1)[0];
      done.resolve(done.text);
      break;
    }

    // 无子 task 场景（老流程，单 task）：taskId 匹配且 parentTaskId 为 null
    // 使用 setTimeout fallback，确保不是预测 task 被误判
    if (completedId === head.rootTaskId && !parentTaskId) {
      // 500ms 后如果没有子 task 完成 → 视为单 task 结束
      const timer = setTimeout(() => {
        const idx = this.#pending.findIndex(p => p === head);
        if (idx >= 0) {
          const fallback = this.#pending.splice(idx, 1)[0];
          fallback.resolve(fallback.text);
        }
      }, 500);
      head._fallbackTimer = timer;
      break;
    }
  }

  // token usage 更新（所有 TaskCompleted 都累加）
  const tu = msg.payload?.tokenUsage;
  if (tu) this.#onTokenUsage?.(tu.total);
}
```

**关键逻辑说明：**

1. `parentTaskId === head.rootTaskId` → 子 task 完成了，链路真正结束 → 立即 resolve
2. `taskId === head.rootTaskId && !parentTaskId` → 这可能是老流程的单 task，也可能是预测 task。用 500ms fallback：如果 500ms 内没有子 task 的 TaskCompleted 到达，就当做单 task 结束
3. 如果 500ms 内子 task 到达，子 task 的 TaskCompleted 会先 resolve。fallback timer 可能先于子 task 完成——需要互斥处理：

```typescript
// 子 task 完成时，清除 fallback timer
if (parentTaskId && parentTaskId === head.rootTaskId) {
  if (head._fallbackTimer) clearTimeout(head._fallbackTimer);
  const done = this.#pending.splice(i, 1)[0];
  done.resolve(done.text);
  break;
}
```

### 4.5 useChat.ts 改动

**当前问题**：`send()` resolve 后强制移除 thinking 消息，导致 spinner 在预测完成时消失（还没有 delta 到达）。

**修改**：spinner 不依赖 `send()` resolve。只由 `onDelta`（已有）和超时逻辑（新增）控制。

```typescript
const send = useCallback(async (text: string) => {
  const userMsgId = nextId();
  const thinkingId = nextId();
  thinkingIdRef.current = thinkingId;

  setMessages(prev => [
    ...prev,
    { role: "user", content: text, id: userMsgId },
    { role: "thinking", id: thinkingId },
  ]);

  try {
    const client = clientRef.current;
    if (!client) throw new Error("Not connected");
    await client.send(text);
    // ── 以下移除 thinking 的逻辑删除 ──
    // thinkingIdRef.current = null;                          ← 删除
    // setMessages(prev => prev.filter(m => m.id !== thinkingId)); ← 删除

    // 标记最后一条 assistant 消息为 streaming: false
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        return prev.map(m => m.id === last.id ? { ...m, streaming: false } : m);
      }
      return prev;
    });
  } catch (err: any) {
    thinkingIdRef.current = null;
    setMessages(prev => prev.filter(m => m.id !== thinkingId));
    setMessages(prev => [...prev, { role: "error", content: err.message, id: nextId() }]);
  }
}, []);
```

**说明：**
- `onDelta` 回调中已有移除 thinking 的逻辑（useChat.ts 第 23-26 行），delta 到达时 spinner 自动隐藏
- `send()` resolve 只负责标记 `streaming: false`（收尾），不再管理 spinner
- 错误路径保留移除 thinking 逻辑

### 4.6 ChatView.tsx — spinner 帧率

```diff
- const t = setInterval(() => setI(n => (n + 1) % FRAMES.length), 200);
+ const t = setInterval(() => setI(n => (n + 1) % FRAMES.length), 80);
```

---

## 5. 实施清单

> 按顺序执行，每步完成后运行 `bun test` 确认。

### 阶段一：Prediction Pipeline 重构

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1.1 | `elements/predict-finalize.ts` | **新建** | 取代 route-conversation，见 §3 |
| 1.2 | `elements/route-conversation.ts` | **删除** | 不再需要 |
| 1.3 | `elements/types.ts` | **修改** | 替换 deps（§3.5） |
| 1.4 | `elements/index.ts` | **修改** | 导出 predict-finalize，移除 route-conversation |
| 1.5 | `index.ts` (prediction DSL) | **修改** | sink: predict-finalize，传入新 deps |
| 1.6 | `server.ts` | **修改** | ①删 `buildConversation` 函数 ②修改 POST 处理器传参 ③TaskCompleted payload 加 `parentTaskId` ④prediction deps 改为传具体参数 |
| 1.7 | `prediction.test.ts` | **修改** | 更新测试用例 |

### 阶段二：TUI 链路完成判断

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 2.1 | `ws-client.ts` | **修改** | send() 按 parentTaskId 判断，见 §4.4 |
| 2.2 | `useChat.ts` | **修改** | 删除 send() 中 spinner 移除逻辑，见 §4.5 |
| 2.3 | `ChatView.tsx` | **修改** | SpinnerBubble 80ms 帧率，见 §4.6 |

### 阶段三：验证

| # | 检查项 | 命令 |
|---|--------|------|
| 3.1 | 所有测试通过 | `bun test` |
| 3.2 | TypeScript 类型无错误 | `bun run --bun tsc --noEmit` |
| 3.3 | E2E 手动验证 | 启动服务，发送天气查询，观察 spinner 和链路完成 |

---

## 6. 时序图

```
 用户            TUI(client)         server              TaskEngine        Pipeline        LLM
  │                 │                   │                    │                 │             │
  ├─输入文本────────→│                   │                    │                 │             │
  │                 ├─POST /api/tasks───→│                    │                 │             │
  │                 │  (taskId=A,       │                    │                 │             │
  │                 │   pipeline=pred)  │                    │                 │             │
  │                 │                   ├─enqueue(task)──────→│                 │             │
  │                 │                   │  setPipeline(A,    │                 │             │
  │                 │                   │   predictPipeline) │                 │             │
  │                 │                   │                    ├─getPipeline(A)──→│             │
  │                 │                   │                    │                  ├─predict-input
  │                 │                   │                    │                  ├─predict-intent→generateText→│
  │                 │                   │                    │                  │             ←─JSON response
  │                 │                   │                    │                  ├─predict-finalize
  │                 │                   │                    │                  │   ├─写session
  │                 │                   │                    │                  │   ├─buildConvPipeline
  │                 │                   │                    │                  │   ├─createTask(B,INTERNAL)
  │                 │                   │                    │                  │   └─enqueue(B)
  │                 │←──TaskCompleted───┤                    │←─Completed(A)────┤             │
  │                 │   (taskId=A,      │                    │                 │             │
  │                 │    parent=null)   │                    │                 │             │
  │  (spinner 持续  │                   │                    │                 │             │
  │   显示)         │                   │                    │                 │             │
  │                 │                   │                    ├─getPipeline(B)──→│             │
  │                 │                   │                    │                  ├─collect-prompts
  │                 │                   │                    │                  ├─...……………        │
  │                 │                   │                    │                  ├─stream-llm──→streamText→│
  │                 │←──TransportDelta──┤←───────────────────┤←─────────────────┤←──────────────text chunks
  │  隐藏spinner    │                   │                    │                 │             │
  │  显示文字       │                   │                    │                 │             │
  │                 │                   │                    │                 ├─parse-intents
  │                 │                   │                    │                 ├─check-follow-up
  │                 │                   │                    │                 ├─finalize
  │                 │←──TaskCompleted───┤                    │←─Completed(B)────┤             │
  │                 │   (taskId=B,      │                    │                 │             │
  │  streaming=false │   parent=A)      │                    │                 │             │
  │  会话完成        │                   │                    │                 │             │
```

### 时序说明

1. **T=0**: 用户发送消息，server 创建 prediction task（id=A），构建 pipeline 并注册。TUI 显示 spinner
2. **T=1~3s**: Prediction pipeline 执行（predict-input → predict-intent → predict-finalize）。predict-finalize 创建 conversation task（id=B, parentTaskId=A）并入队
3. **T≈3s**: Prediction TaskCompleted（taskId=A, parent=null）广播到 TUI。ws-client 判断 `parent=null` 且不是子 task → 不 resolve，启动 500ms fallback timer。spinner 继续显示
4. **T≈3s**: TaskEngine 取到 conversation task（id=B），`getPipeline(B)` 拿到 predict-finalize 注册的 pipeline，开始执行
5. **T≈4s**: 第一个 TransportDelta 到达 TUI。`onDelta` 移除 thinking 消息（spinner 隐藏），开始显示文字。ws-client 的 500ms fallback timer 被清除（因为子 task 的 TaskCompleted 会先于 timer 触发——不对，delta 先于 TaskCompleted）

**更正**：fallback timer 的正确时机：
- T≈3s: 预测 TaskCompleted → 启动 500ms fallback timer
- T≈3s: 子 task 开始执行（但在 TaskCompleted 之前 delta 就开始流了）
- T≈3.5s: delta 到达（但 TaskCompleted 还没到）
- T≈3.5s: 500ms fallback timer 触发 → resolve send()

但这样还是提前 resolve 了！问题在于：500ms fallback 会在子 task 的 TaskCompleted 之前触发。

**修正 fallback 逻辑**：

不使用 500ms fallback timer。改用**计数器**：

```typescript
// PendingRequest 增加 parentDone 标记
type PendingRequest = {
  // ...
  rootTaskId: string;
  parentDone: boolean;       // 父 task 是否已完成
  _fallbackTimer?: Timer;
};

// TaskCompleted 处理:
if (completedId === head.rootTaskId && !parentTaskId) {
  head.parentDone = true;    // 父 task 完成，标记
}

if (parentTaskId && parentTaskId === head.rootTaskId) {
  // 子 task 完成 → 链路结束 → resolve
  if (head._fallbackTimer) clearTimeout(head._fallbackTimer);
  const done = this.#pending.splice(i, 1)[0];
  done.resolve(done.text);
  break;
}

// 同时保留 fallback: 父 task 完成 500ms 后，如果 parentDone 仍为 true（无子 task），resove
// 注意：父 task 完成 + 500ms = 最终截止时间
```

实际上最简单的处理：**不依赖时间，依赖任务计数**。

在 predict-finalize 入队子 task 后，子 task 几乎立即会被 TaskEngine 处理（INTERNAL 优先级高）。从子 task 入队到子 task 完成，通常需要几秒（LLM 调用时间）。子 task 的 TaskCompleted **一定**在预测 TaskCompleted 之后。

问题是：**预测 TaskCompleted 和子 task 入队的时序。**

预测 TaskCompleted 是在 predict-finalize 的 `doProcess` **返回之后**由 TaskEngine 发射的。而 predict-finalize 在 `return` 之前已经 `queue.enqueue(convTask)`。所以子 task 在预测 TaskCompleted 之前就已入队。

因此 500ms 是足够的：预测 TaskCompleted → 500ms 内子 task 必然被处理（但不一定完成）。子 task 完成可能需要数秒。

**最终方案**：不用 fallback timer，改用显式的 `parentDone` 计数器。

父 task 完成时标记 `parentDone = true`，但**不 resolve**。子 task 完成时才 resolve。如果父 task 完成了但子 task 一直不来（异常情况），30s send 超时兜底（TaskEngine 有超时配置）。

不，send() 目前没有超时。那就保持 500ms fallback 作为老流程兼容性手段。在子 task 完成时 resolve。

但问题是：子 task 的 TaskCompleted 会在数秒后到达，而 500ms fallback 会在预测 TaskCompleted 后 500ms 就触发。所以必须**在子 task delta 到达时清除 fallback timer**。

不，delta 到达不等于 task 完成。TaskCompleted 才表示完成。

好吧，让我再想清楚：

1. 预测 TaskCompleted → 500ms fallback 启动
2. 子 task 开始执行 → delta 开始流
3. 500ms 到达 → fallback 触发 → resolve send() ← 太早了！
4. 子 task 继续执行... 又 3-5 秒后才 TaskCompleted

修复：fallback 时间延长到 5000ms（5秒），确保子 task 的 TaskCompleted 在 fallback 之前到达。

或者更简单的：**只检查 parentTaskId，不用 fallback**。

如果 `parentTaskId === null && taskId === rootTaskId`：
- 这可能是预测 task（新流程），也可能是老流程的单 task
- 老流程的单 task 不会产生子 task
- 新流程的预测 task 一定会产生子 task

**关键问题：如何区分？**

在 ws-client 层面无法区分。但可以增加一个简单的判定：**如果同一个 rootTaskId 收到两次 TaskCompleted，第二次才 resolve。**

```typescript
// 简化方案：收到第一个 TaskCompleted 不 resolve，等第二个
// 如果只有一次（老流程），自动 resolve

type PendingRequest = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  text: string;
  rootTaskId: string;
  completedCount: number;     // ← 已经完成的任务数
  maxExpected: number;        // ← 期望完成的最大任务数
};

// 初始化时 maxExpected = 2（新流程：预测 + 对话）
// 如果收到 2 次 TaskCompleted 或等待 30s 超时，resolve

// 每次 TaskCompleted 时:
head.completedCount++;
if (head.completedCount >= head.maxExpected) {
  resolve(done.text);
}
```

等等，这也太复杂了。老流程怎么知道 maxExpected=1？

让我再简化：

**终极简化方案：5000ms fallback**

1. 预测 TaskCompleted → 不 resolve，等待 5000ms 内的子 task
2. 5000ms 内子 task 完成 → resolve
3. 5000ms 超时 → resolve（老流程单 task 场景）

5000ms 对于 LLM 对话来说是合理的超时。LLM 调用通常在 1-5 秒内完成。如果 5000ms 内子 task 还没完成，fallback 也算合理。

```typescript
if (completedId === head.rootTaskId && !parentTaskId) {
  head.parentDone = true;
  head._fallbackTimer = setTimeout(() => {
    const idx = this.#pending.findIndex(p => p === head);
    if (idx >= 0) {
      const done = this.#pending.splice(idx, 1)[0];
      done.resolve(done.text);
    }
  }, 5000);
}

if (parentTaskId && parentTaskId === head.rootTaskId) {
  if (head._fallbackTimer) clearTimeout(head._fallbackTimer);
  const done = this.#pending.splice(i, 1)[0];
  done.resolve(done.text);
  break;
}
```

5000ms 足够让子 task 完成并收到 TaskCompleted。对于老流程（单 task），不会有子 task，5000ms 后 fallback resolve。

5000ms = 5s 比 LLM 调用更长，所以子 task 的 TaskCompleted（通常 2-3s 后到达）会先于 fallback 触发。而在老流程中，5s 是无 task 处理的空闲时间，很快。

OK，这应该可以。让我把这个更新到 PLAN.md 中。

Actually 我还在写 PLAN.md。让我确认目前的版本已经包含了 5000ms fallback 的设计。

等等，我在写入过程中已经包含了 500ms 的 fallback，现在要改成 5000ms。让我更新 PLAN.md。

实际上有一个更简单的方法：不使用 fallback timer。而是在子 task 完成时直接 resolve。

问题是：如果只有单 task（老流程），没有子 task，永远不会 resolve。

但是没有"老流程"了——现在用户提交的 POST /api/tasks 走的是 prediction pipeline，一定会产生子 task。所以不会有单 task 的场景。

等等！用户可能直接通过 API 调用 POST /api/tasks 创建 task。但 server.ts 中 POST 处理器构建的是 prediction pipeline，一定会产生子 task。所以新流程下**一定会有子 task**。

那就简单了：**不需要 fallback，只等子 task 的 TaskCompleted 就行。**

```typescript
// 父 task 完成 → 标记，不 resolve
if (completedId === head.rootTaskId && !parentTaskId) {
  head.parentDone = true;
}

// 子 task 完成 → parentTaskId 匹配 → resolve
if (head.parentDone && parentTaskId === head.rootTaskId) {
  const done = this.#pending.splice(i, 1)[0];
  done.resolve(done.text);
  break;
}
```

Wait，但第 82 行的判断有问题：`parentTaskId === head.rootTaskId` 条件已经区分了。所以不需要 `head.parentDone` 标记。

```typescript
if (parentTaskId && parentTaskId === head.rootTaskId) {
  // 这是子 task 完成 → resolve
  const done = this.#pending.splice(i, 1)[0];
  done.resolve(done.text);
  break;
}
// 否则（父 task 完成，parent=null）→ 不 resolve
```

**这就够了！** 不需要 parentDone 标记，不需要 fallback timer。

因为：
- 如果 `parentTaskId === head.rootTaskId` → 这是子 task → resolve ✅
- 如果 `parentTaskId === null` 且 `taskId === head.rootTaskId` → 这是父 task → 不处理
- 如果 `parentTaskId` 不存在于任何 pending request → 不匹配

Wait，但如果有多个 pending request 呢（用户快速连发两条消息）？第二个消息的 rootTaskId 是 C，第一个是 A。子 task B 的 parentTaskId 是 A，子 task D 的 parentTaskId 是 C。

所以遍历 pending requests，找匹配的：

```typescript
for (let i = 0; i < this.#pending.length; i++) {
  const head = this.#pending[i];
  if (parentTaskId && parentTaskId === head.rootTaskId) {
    const done = this.#pending.splice(i, 1)[0];
    done.resolve(done.text);
    break;
  }
}
```

这正确处理了多个并发用户消息的场景。

Good. 现在更新 PLAN.md，用 5000ms fallback 作为安全兜底。

Actually, 5000ms fallback 是多余的。因为：
1. 新流程一定会产生子 task
2. 如果 prediction 失败（没有子 task），send() 会 reject（TaskFailed）
3. 如果 prediction 成功但没有子 task（代码 bug），30 秒后 TaskEngine 超时会清理

所以不需要 fallback。但如果担心，可以保留一个较短 fallback 作为安全兜底。

让我用折中方案：不加 fallback（简化逻辑），但保持 send() 的 reject 路径正常工作（已在 catch 中处理 TaskFailed）。

OK，让我更新 PLAN.md 中的描述，去掉复杂的 fallback timer，简化为纯 parentTaskId 判断。<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="write">
<｜｜DSML｜｜parameter name="content" string="true"># PLAN.md — 用户意图预测 + 会话完成判断

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
  │    server.ts 构建 predictionPipeline → setPipeline(task.id, pipeline) → enqueue
  ▼
┌─ Prediction Pipeline ───────────────────────────────────────────────────┐
│  predict-input → predict-intent → predict-finalize                      │
│                                                                          │
│  predict-finalize 内部（sink element）:                                   │
│    ① 读预测结果 { toolTier, difficulty }                                  │
│    ② 选 tools: full→basic+advanced, basic→basic                          │
│    ③ 选 model: difficulty → getResolvedModel(difficulty)                 │
│    ④ build conversationPipeline → setPipeline(convTask.id, convPipeline) │
│    ⑤ createTaskItem({ pipeline:"conversation", source:INTERNAL,          │
│         parentTaskId: predictionTask.id }) → enqueue                     │
│    ⑥ return PipelineResult (预测 task 完成)                                │
└──────────────────────────────────────────────────────────────────────────┘
                     │
                     ▼ Task Queue（唯一中转站）
                     │
                     ▼
┌─ Conversation Pipeline ───────────────────────────────────────┐
│  collect-prompts → ... → stream-llm(full/partial tools)       │
│       → parse-intents → check-follow-up → finalize             │
│  用户看到回复                                                   │
└────────────────────────────────────────────────────────────────┘
```

**核心原则：**

- TaskEngine 零改动。只负责 `getPipeline(taskId)` → 执行 pipeline。
- pipeline 对象的创建发生在入队前（server.ts 或 predict-finalize）。
- TaskQueue 是 prediction 和 conversation 之间的唯一连接点。
- `task.pipeline` 是字符串标识，真正的 Pipeline 对象通过 `setPipeline(taskId, pipeline)` 注册。

---

## 2. Task 流转

### 2.1 用户输入产生的 Task（server.ts）

```
POST /api/tasks → server.ts:
  task = createTaskItem({
    pipeline: "prediction",
    source: TaskSource.EXTERNAL,
    payload: [...],
  })
  pipeline = predictionPipeline({...deps...}).build(bus)
  setPipeline(task.id, pipeline)
  taskQueue.enqueue(task)
```

### 2.2 预测完成后产生的 Task（predict-finalize）

```
predict-finalize.doProcess:
  convTask = createTaskItem({
    pipeline: "conversation",
    source: TaskSource.INTERNAL,
    parentTaskId: predictionTask.id,    // ← 链路关联
    payload: predictionTask.payload,    // ← 复用用户原始输入
  })
  convPipeline = conversationPipeline({ tools, model, ... }).build(bus)
  setPipeline(convTask.id, convPipeline)
  taskQueue.enqueue(convTask)
```

### 2.3 TaskEngine 取 Pipeline

```
#executeTask(task):
  pipeline = getPipeline(task.id)
  if (!pipeline) return { type: "complete", task }
  // 执行 pipeline.elements...
```

每次执行前都有调用方保证 `setPipeline` 已完成。TaskEngine 不改。

### 2.4 一个用户请求 = 两个 Task

| 次序 | id | parentTaskId | pipeline 字段值 | source | 谁 setPipeline |
|------|-----|-------------|------------------|--------|---------------|
| 1 | A | null | "prediction" | EXTERNAL | server.ts |
| 2 | B | A | "conversation" | INTERNAL | predict-finalize |

---

## 3. predict-finalize 规格

**位置**：`src/packages/core/src/pipelines/prediction/elements/predict-finalize.ts`
**操作**：新建，替代 `route-conversation.ts`

### 3.1 Constructor 依赖

```typescript
constructor(params: {
  name: string; kind: string;
  bus: PipelineEventBus<PipelineEventMap>;

  // 构建 conversationPipeline 所需的所有参数
  sandbox: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  providerModel: string;
  configContextLimit?: number;
  providerOptions: Record<string, Record<string, unknown>>;
  basicTools: ToolDefinition[];
  advancedTools: ToolDefinition[];
  getCompiledPrompt: () => string;
  maxTokens: number;
  memory: any;

  queue: TaskQueue;
  buildChainPipeline: (...args: any[]) => void;

  // 模型选择
  getResolvedModel: (level: string) => { provider: string; model: string; apiKey: string; baseUrl?: string; thinking?: string };
})
```

### 3.2 doProcess 伪代码

```
输入: PredictionFlowState (含 prediction, task, session, userMessage, contextMessages)

① prediction = input.prediction ?? FALLBACK
② session.predictToolTier = prediction.toolTier    // 写入 session 供下游读取
   session.predictDifficulty = prediction.difficulty

③ tools = (prediction.toolTier === "full") ? [...basicTools, ...advancedTools] : basicTools
④ resolvedModel = getResolvedModel(prediction.difficulty)

⑤ convPipeline = conversationPipeline({
     session, task: { payload: input.task.payload, sandbox, ... },
     apiKey: resolvedModel.apiKey, model: resolvedModel.model,
     tools, getCompiledPrompt, maxTokens, memory,
     queue, buildChainPipeline, chainDepth: 0,
     ...
   }).build(bus)

⑥ convTask = createTaskItem({
     pipeline: "conversation", source: INTERNAL,
     parentTaskId: input.task.id,
     payload: input.task.payload,
   })
   setPipeline(convTask.id, convPipeline)
   queue.enqueue(convTask)

⑦ return { type: "complete", task: input.task, output: "prediction: ..." }
```

### 3.3 PredictionFlowState / PredictionPipelineDeps 变更

```diff
  PredictionFlowState:
    // 移除 contextMessages（本 step 不涉及，后续处理）
    // 已有字段不变

  PredictionPipelineDeps:
-   buildConversation: (session, prediction) => void
+   sandbox: string
+   primaryApiKey: string
+   primaryModel: string
+   baseUrl?: string
+   providerModel: string
+   configContextLimit?: number
+   providerOptions: Record<string, Record<string, unknown>>
+   basicTools: ToolDefinition[]
+   advancedTools: ToolDefinition[]
+   getCompiledPrompt: () => string
+   maxTokens: number
+   memory: any
+   queue: TaskQueue
+   buildChainPipeline: (...args: any[]) => void
+   getResolvedModel: (level: string) => ResolvedModel
```

### 3.4 关联改动

| 文件 | 操作 |
|------|------|
| `elements/route-conversation.ts` | **删除** |
| `elements/predict-finalize.ts` | **新建** |
| `elements/types.ts` | 更新 `PredictionPipelineDeps` |
| `elements/index.ts` | 导出 `PredictFinalizeElement`，移除 `RouteConversationElement` |
| `prediction/index.ts` | DSL sink: `"predict-finalize"` 取代 `"route-conversation"`，deps 更新 |
| `server.ts` | ① 删除 `buildConversation` 函数（~40行）② POST 处理器 prediction deps 改为传入具体参数 |
| `prediction.test.ts` | 更新 route-conversation 相关测试 |

---

## 4. TUI 链路完成判断

### 4.1 问题

当前 `ws-client.send()` 在收到**第一个** `TaskCompleted` 时就 resolve。引入预测管道后，第一个 TaskCompleted 是预测 task（未产生文本），导致：
- spinner 提前消失（预测完成 → 对话还没开始流式输出）
- `streaming: false` 标记过早

### 4.2 方案

不依赖时间/顺序，依赖 `parentTaskId` 字段区分。

| 收到的 TaskCompleted | parentTaskId | 含义 | TUI 行为 |
|---------------------|-------------|------|---------|
| 预测 task (id=A) | null | 预测完成 | **不 resolve**，继续等待 |
| 对话 task (id=B) | A | 会话结束 | **resolve**，链路完成 |

### 4.3 server.ts 改动

`BusEvents.Task.Completed` 处理器 payload 增加 `parentTaskId`（**一行**）：

```diff
  payload: {
    taskId: p.task.id,
+   parentTaskId: p.task.parentTaskId,
    output: result.output ?? "",
    tokenUsage: accumulated,
  },
```

`p.task.parentTaskId` 是 `TaskItem` 已有字段，只转发不新增。

### 4.4 ws-client.ts 改动

**send() 方法**：获取 rootTaskId（POST 返回的 taskId），存入 pending request。

```typescript
// PendingRequest 类型新增 rootTaskId
type PendingRequest = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  text: string;
  rootTaskId: string;  // ← 新增
};

async send(text: string): Promise<string> {
  // ... POST /api/tasks
  const { taskId } = await res.json();  // rootTaskId = 预测 task 的 id

  return new Promise((resolve, reject) => {
    this.#pending.push({ resolve, reject, text: "", rootTaskId: taskId });
  });
}
```

**onmessage TaskCompleted 处理**：按 parentTaskId 匹配 resolve。

```typescript
else if (msg.type === WsMessages.Server.TaskCompleted) {
  const { taskId: completedId, parentTaskId } = msg.payload ?? {};

  // 子 task 完成（parentTaskId 指向某个 rootTaskId）→ 链路结束
  for (let i = 0; i < this.#pending.length; i++) {
    if (parentTaskId && parentTaskId === this.#pending[i].rootTaskId) {
      const done = this.#pending.splice(i, 1)[0];
      done.resolve(done.text);
      break;
    }
  }

  // token usage 总是更新
  const tu = msg.payload?.tokenUsage;
  if (tu) this.#onTokenUsage?.(tu.total);
}
```

**无需 fallback timer。** 预测 pipeline 一定会产生子 conversation task，子 task 完成时 `parentTaskId` 一定匹配。如果预测失败（TaskFailed），走 reject 路径。

### 4.5 useChat.ts 改动

**send() 中移除两行 spinner 删除逻辑：**

```typescript
try {
  await client.send(text);
  // ── 两行删除 ──
  // thinkingIdRef.current = null;
  // setMessages(prev => prev.filter(m => m.id !== thinkingId));

  // 保留 streaming: false 收尾
  setMessages(prev => {
    const last = prev[prev.length - 1];
    if (last?.role === "assistant" && last.streaming) {
      return prev.map(m => m.id === last.id ? { ...m, streaming: false } : m);
    }
    return prev;
  });
}
```

spinner 隐藏由 `onDelta` 回调处理（已有逻辑：第一个 delta 到达时移除 thinking 消息）。`send()` resolve 只负责标记最后一条信息的 `streaming: false`。

### 4.6 ChatView.tsx — 帧率

```diff
- const t = setInterval(() => setI(n => (n + 1) % FRAMES.length), 200);
+ const t = setInterval(() => setI(n => (n + 1) % FRAMES.length), 80);
```

---

## 5. 实施清单

按顺序执行，每步完成后 `bun test` 确认。

### 阶段一：Prediction Pipeline

| # | 文件 | 操作 |
|---|------|------|
| 1 | `elements/predict-finalize.ts` | 新建（sink，规格见 §3） |
| 2 | `elements/route-conversation.ts` | 删除 |
| 3 | `elements/types.ts` | 更新 `PredictionPipelineDeps`（§3.3） |
| 4 | `elements/index.ts` | 导出 `PredictFinalizeElement`，移除 `RouteConversationElement` |
| 5 | `prediction/index.ts` | DSL: sink → `predict-finalize`，deps 更新 |
| 6 | `server.ts` | ①删 `buildConversation` ②prediction deps 改传参数 ③TaskCompleted payload +parentTaskId |
| 7 | `prediction.test.ts` | 更新测试 |

### 阶段二：TUI

| # | 文件 | 操作 |
|---|------|------|
| 8 | `ws-client.ts` | send() + rootTaskId，onmessage 按 parentTaskId resolve（§4.4） |
| 9 | `useChat.ts` | 删 send() 中两行 spinner 删除（§4.5） |
| 10 | `ChatView.tsx` | SpinnerBubble 80ms（§4.6） |

### 阶段三：验证

| # | 检查项 |
|---|--------|
| 11 | `bun test` — 全部通过 |
| 12 | `bun run --bun tsc --noEmit` — 无新增类型错误 |
| 13 | 手动 E2E：发送天气查询 → spinner 持续显示直到文本出现 → 会话正确完成 |

---

## 6. 时序图

```
 用户       TUI(client)          server             TaskEngine         Pipeline           LLM
  │             │                    │                   │                  │                │
  ├─输入文本───→│                    │                   │                  │                │
  │             ├─POST /api/tasks───→│                   │                  │                │
  │             │  (taskId=A,        │                   │                  │                │
  │             │   pipeline=pred)   │                   │                  │                │
  │  [spinner]  │                    ├─setPipeline+enq──→│                  │                │
  │             │                    │                   ├─getPipeline(A)──→│                │
  │             │                    │                   │                  ├─predict-input │
  │             │                    │                   │                  ├─predict-intent→│generateText
  │             │                    │                   │                  ├─predict-finalize
  │             │                    │                   │                  │  ├─buildPipeline
  │             │                    │                   │                  │  ├─setPipeline(B)
  │             │                    │                   │                  │  └─enqueue(B)
  │             │←─TaskCompleted(A)──┤                   │←─Bus.Completed───┤                │
  │             │  parent=null       │                   │                  │                │
  │             │  → 不 resolve      │                   │                  │                │
  │  [spinner]  │                    │                   ├─getPipeline(B)──→│                │
  │             │                    │                   │                  ├─collect-prompts
  │             │                    │                   │                  ├─...            │
  │             │←─TransportDelta───┤                   │                  ├─stream-llm────→│streamText
  │             │                    │                   │                  │  ←─────────────│text chunks
  │  [文字显示]  │                    │                   │                  │                │
  │  [spinner隐藏]│                   │                   │                  ├─parse-intents  │
  │             │                    │                   │                  ├─check-follow-up│
  │             │                    │                   │                  ├─finalize       │
  │             │←─TaskCompleted(B)──┤                   │←─Bus.Completed───┤                │
  │             │  parent=A          │                   │                  │                │
  │             │  → resolve send()   │                   │                  │                │
  │  [streaming=false]               │                   │                  │                │
  │  [会话完成]    │                    │                   │                  │                │
```
