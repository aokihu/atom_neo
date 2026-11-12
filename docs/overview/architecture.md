# System Architecture

> **Purpose**: Agent development reference for Atom Neo's runtime design.

---

## 1. 核心设计哲学

| 维度 | 设计 | 收益 |
|------|------|------|
| **任务调度** | 事件驱动：task 入队 → 立即触发 pipeline | 无空转延迟，响应时间 O(1) |
| **上下文管理** | Per-Session 隔离，每个 session 独立实例 | 多 session 并发安全，无需全局锁 |
| **Memory 操作** | `search_memory` / `read_memory` / `save_memory` 注册为 Tool | 摘要发现与正文读取分离 |
| **LLM 输出解析** | `streamText` + tool calling（流式输出 + 结构化工具调用）| 流式体验 + 零解析错误 |
| **Pipeline 组装** | 声明式 `PipelineBuilder`，Element 通过名称引用 | 运行时注册新 pipeline |
| **通信** | WebSocket 事件流（Core → Client 广播）；TUI 任务提交走 `POST /api/tasks` | 可观测 |
| **调试** | Pipeline Replay — **规划中**，录制/播放器尚未接入执行路径 | 目标：问题复现成本降低 |
| **运行时架构** | 当前由 `startCore` 组装 services + PipelineBuilder；Orchestrator / IntentPolicy / ToolCoordinator / MemoryManager 为**规划中**，代码中尚未实现 | 目标：职责单一，可独立测试 |

---

## 2. 系统架构

### 2.1 三层模型

```mermaid
graph TB
    subgraph TUI["TUI (OpenTUI + React)"]
        StatusBar["StatusBar"]
        ChatView["ChatView"]
        InputBar["InputBar"]
        Sidebar["Sidebar"]
    end

    subgraph Gateway["Gateway (Client 中转层)"]
        ClientMgr["Client Manager"]
        SecretAuth["Secret Auth"]
    end

    subgraph Clients["Platform Clients (子进程)"]
        WeChat["WeChat Bot"]
        Telegram["Telegram Bot"]
    end

    subgraph Core["Core Engine"]
        HTTP["HTTP Server"]
        Bus["Pipeline Bus"]
        ToolReg["Tool Registry"]
        TaskEng["Task Engine"]
        WS["WebSocket"]
        Memory["Memory Plugin"]

        HTTP --> Bus
        Bus --> TaskEng
        TaskEng --> ToolReg
        TaskEng --> Memory
        WS --> Bus
    end

    InputBar -->|"POST /api/tasks"| HTTP
    ClientMgr -->|"stdin/stdout (token)"| WeChat
    ClientMgr -->|"stdin/stdout (token)"| Telegram
    SecretAuth -->|"inbound message"| HTTP
    WS -->|"transport.delta"| ChatView
```

**架构原则：**
- Core 不轮询队列 → 事件驱动激活
- 每个 session 独立的 SessionContext 实例 → 无状态共享
- Memory 是 Tool Plugin → 走统一调用路径
- 所有通信走 WebSocket 事件流 → 全域可观测

### 2.2 模块结构

```text
atom_neo/
├── src/
│   ├── main.ts                   # 应用入口，CLI 解析 + 启动调度
│   ├── bootstrap/                # 启动层
│   │   ├── cli.ts               # CLI 参数解析
│   │   ├── config.ts            # config.json 加载
│   │   └── env.ts               # .env 加载
│   └── packages/
│       ├── core/
│       │   ├── server.ts         # startCore(deps): composition root + Bun.serve
│       │   ├── bootstrap.ts      # Constructs services, tools, MCP, pipelines, WS handlers
│       │   ├── pipeline-factory.ts / task-lifecycle.ts
│       │   ├── http-router.ts / mcp-lifecycle.ts
│       │   ├── task-engine.ts
│       │   ├── task-queue.ts / task-factory.ts
│       │   ├── pipeline/         # builder / registry / manager
│       │   ├── session/          # context / store / checkpoint / history / format / durable-fs
│       │   ├── context/          # facade / bucket-store / snapshot-manager / codec / compiler
│       │   ├── tools/            # registry / executor / builtin
│       │   ├── replay/           # recorder / player
│       │   ├── ws/               # handler / broadcaster
│       │   ├── api/              # tasks / health
│       │   └── pipelines/        # conversation / prediction / follow-up-evaluator / context-compress / post-conversation
│       │       └── conversation/elements/stream/  # loop / step / tool-batch / runtime / reporting / finalize
│       │
│       ├── shared/               # types / pipeline-core / log / protocol / utils
│       ├── gateway/              # secret auth / client-manager (supervisor / command / termination)
│       └── tui/                  # OpenTUI React: App / ChatView / InputBar / Sidebar / hooks
│
├── sandbox/                      # 运行时工作目录
│   ├── config.json              # Model/TUI/Gateway 配置
│   └── .env                     # API Keys
└── docs/
```

**S12 结构边界（v1.24.0）**：Core 的四个巨型文件已按行为边界拆分，facade 保持原公共 API：
`StreamLLMElement`（`stream-llm.ts`）只保留 shell，循环/step/工具/上报/finalize 位于
`pipelines/conversation/elements/stream/`；`MemoryService` 委托 `memory/` 的 store/query/graph；
`ContextService` 委托 `bucket-store` / `snapshot-manager`；`SessionPersistenceService` 委托
`checkpoint-store` / `history-store` / `session-format` / `durable-fs`。
TUI 的 store 由 slices 组合，面板/Modal/Wizard 只保留组合与渲染；Wizard 由 reducer 驱动。
S12 只改变文件边界，事件顺序、DB schema、目录/JSONL 格式、HTTP/WS 路由与 Task/Event 契约不变。

---

## 3. 核心创新详解

### 3.1 事件驱动调度

```typescript
class TaskEngine {
  #running = false;
  #wake = new Wakeup();

  constructor(bus: PipelineEventBus, queue: TaskQueue) {
    bus.on("task.enqueued", () => this.#wake.notify());
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    void this.#runLoop();
  }

  async #runLoop() {
    while (this.#running) {
      const task = this.#queue.dequeue();
      if (!task) {
        await this.#wake.wait();
        continue;
      }
      await this.#runTask(task);
    }
  }
}
```

**优势：** 无空转等待、无 timer/轮询；任务严格串行执行；`Task.Enqueued` 只负责唤醒循环。

### 3.2 Per-Session 上下文隔离

```typescript
class SessionContext {
  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.messages = [];
    this.inferenceContext = { hiddenFacts: [] };
    this.toolContext = { mode: "idle" };
    this.memoryScopes = { core: "idle", short: "idle", long: "idle" };
  }
}

const session = sessionStore.get(sessionId);
const ctx = session.context;
ctx.addMessage(message);
ctx.setInferenceFacts(facts);
```

**优势：** 多用户并发安全，session 之间完全隔离，销毁简单（`sessionStore.delete(id)`）。

### 3.3 声明式 Pipeline Builder

```typescript
const conversationPipeline = pipeline("conversation")
  .source("collect-prompts", { session })
  .transform("load-system-prompt", {})
  .transform("fetch-agents-prompt", { getCompiledPrompt })
  .transform("collect-context", {})
  .transform("format-system-messages", {})
  .transform("format-user-messages", {})
  .transform("stream-llm", { apiKey, model, tools })
  .boundary("check-follow-up", {})
  .sink("finalize", {})
  .build();
```

**优势：** Element 按名称查找而非硬编码 import。Pipeline 热重载（`PipelineManager` 监听/重载）目前**未实现**，仅保留构建与注册能力。

### 3.4 Streaming + Tool Calling + IntentRequest

```typescript
// 核心：streamText 提供流式输出 + 结构化工具调用
const result = streamText({
  model,
  system: systemText,          // 独立 system 参数
  messages: userMessages,      // 仅 user/assistant
  tools: aiTools,              // AI SDK 原生工具数组
  maxSteps: 50,
});

let fullText = "";
for await (const chunk of result.fullStream) {
  if (chunk.type === "text-delta") {
    fullText += chunk.textDelta;
    bus.emit("transport.delta", { textDelta: chunk.textDelta });
  }
  if (chunk.type === "tool-call") {
    // 工具调用融入对话流，用户可感知
  }
}

// 流结束后，tail 解析隐蔽 intent
const intents = parseIntentRequests(fullText);
if (intents.some(i => i.request === IntentRequestType.FOLLOW_UP)) {
  ctx.setContinuationContext({ ... });
}
```

**两条路径分工：**
| 机制 | 工具 | 用户感知 | 时机 |
|------|------|----------|------|
| `streamText` tool calling | read, write, shell, background_shell, search_memory 等 | ✅ 可见，正常反馈 | 流式输出中 |
| IntentRequest 解析 | 仅 `follow_up` | ❌ 无感，隐蔽调度 | 流结束后 |

**优势：** 流式逐字输出 + 工具调用不打断阅读 + follow_up 隐蔽执行，用户无感知。

### 3.5 Pipeline Replay（录制与重放）

> **状态：未接线（规划中）。** `PipelineRecorder` / `PipelinePlayer` 仅在 `src/packages/core/src/replay/` 导出并被测试引用，尚未接入 server、task engine 或 pipeline 执行路径。

```typescript
class PipelineRecorder {
  record(taskId: string, events: PipelineEvent[]): void;
  replay(taskId: string): AsyncIterable<PipelineEvent>;
}

class PipelinePlayer {
  async play(taskId: string) {
    for await (const event of recorder.replay(taskId)) {
      await bus.emit(event.type, event.payload);
    }
  }
}
```

**优势：** 出错后直接重放查看问题，无需重建上下文。开发期快速迭代 pipeline 逻辑。

---

## 4. Pipeline 简化

### 4.1 Pipeline 一览

| Pipeline | 元素数 | 职责 |
|----------|--------|------|
| `conversation` | 8 | 核心对话管线：加载上下文 → 调用 LLM → 处理结果 → 链式续写 |
| `prediction` | 3 | 意图预测：输入分类、难度评估、主题检测 |
| `follow-up-evaluator` | 3 | 长会话质量保障、循环检测、必要时干预或升级模型 |
| `context-compress` | 4 | Token 超限自动压缩（含 token-ratio）。双触发：① Evaluator 检测 80%+ 阈值 ② Conversation 实时 token overflow 检测 |
| `post-conversation` | 3 | 每轮对话后分析结果质量，判定是否需要重试 |

### 4.2 Tool Plugin 接口

```typescript
// src/packages/shared/src/types/tool.ts

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  execute(args: unknown): Promise<ToolResult>;
}

export interface ToolResult {
  ok: boolean;
  output: string;        // 给 LLM 看的文本结果
  data: unknown;        // 结构化结果（给程序用）
  metadata?: {
    tokensUsed?: number;
    durationMs?: number;
    permission: PermissionLevel;
  };
}

// 内置 tools
const builtinTools: ToolDefinition[] = [
  readTool, writeTool, lsTool, grepTool, treeTool, cpTool, mvTool,
  shellTool, backgroundShellTool, // 需确认
  searchMemoryTool, saveMemoryTool, traverseMemoryTool, linkMemoryTool, forgetMemoryTool,
];
```

### 4.3 Pipeline Builder DSL

```typescript
// src/packages/core/src/pipeline/builder.ts

export function pipeline(name: string): PipelineBuilder {
  return new PipelineBuilder(name);
}

class PipelineBuilder {
  source( elementName: string, deps?: ElementDeps): this;
  transform(elementName: string, deps?: ElementDeps): this;
  boundary( elementName: string, deps?: ElementDeps): this;
  sink(    elementName: string, deps?: ElementDeps): this;

  build(): Pipeline;
}

// Element 注册表
const elementRegistry = new Map<string, ElementConstructor>();

elementRegistry.set("collect-prompts", CollectPromptsElement);
elementRegistry.set("load-system-prompt", LoadSystemPromptElement);
elementRegistry.set("fetch-agents-prompt", FetchAgentsPromptElement);
elementRegistry.set("collect-context", CollectContextElement);
elementRegistry.set("format-system-messages", FormatSystemMessagesElement);
elementRegistry.set("format-user-messages", FormatUserMessagesElement);
elementRegistry.set("stream-llm", StreamLLMElement);
elementRegistry.set("check-follow-up", CheckFollowUpElement);
elementRegistry.set("finalize", FinalizeConversationElement);

// 使用
const pipeline = pipeline("conversation")
  .source("collect-prompts", { runtime })
  .transform("load-system-prompt", {})
  .transform("fetch-agents-prompt", { getCompiledPrompt })
  .transform("collect-context", { runtime, config })
  .transform("format-system-messages", {})
  .transform("format-user-messages", {})
  .transform("stream-llm", { apiKey, model, tools, bus })  // streamText + tool calling
  .boundary("check-follow-up")  // 解析 follow_up IntentRequest
  .sink("finalize", { runtime })
  .build();
```

---

## 5. WebSocket 事件协议

```typescript
// src/packages/shared/src/protocol.ts

// Client → Core
type ClientEvent =
  | { type: "event.task.submit"; payload: TaskSubmitPayload }
  | { type: "event.task.cancel"; payload: { taskId: string } };

// Core → Client (广播)
type ServerEvent =
  | { type: "event.pipeline.element.started"; payload: ElementStartedPayload }
  | { type: "event.pipeline.element.finished"; payload: ElementFinishedPayload }
  | { type: "event.transport.delta"; payload: TransportDeltaPayload }
  | { type: "event.transport.tool.started"; payload: ToolStartedPayload }
  | { type: "event.transport.tool.finished"; payload: ToolFinishedPayload }
  | { type: "event.task.completed"; payload: TaskCompletedPayload }
  | { type: "event.task.failed"; payload: TaskFailedPayload }
  | { type: "event.task.state-changed"; payload: TaskStatePayload }
  | { type: "event.pipeline.replay-start"; payload: ReplayStartPayload }
  | { type: "event.pipeline.replay-end"; payload: ReplayEndPayload };
```

核心事件统一走 WebSocket，无 HTTP 轮询。TUI 通过 `POST /api/tasks` 提交任务，并用 WebSocket 接收事件；WS `task.submit` 仍保留为兼容入口。TUI 直连 Core 的 HTTP/WebSocket；Gateway 仅为外部平台 Client 子进程提供消息中转，通过一次性 Secret 验证。

---

## 6. HTTP API（Core）

```
POST   /api/tasks              → 提交任务（返回 taskId）
GET    /api/tasks/:id          → 查询任务状态
DELETE /api/tasks/:id?sessionId=:sid → 校验 Session 并取消整条 Task Chain
WS     /ws/:sessionId          → WebSocket 事件流（事件接收；兼容 task.submit）
GET    /api/health             → 健康检查
GET    /api/metrics            → 运行时指标
```

---

## 7. 权限模型

```typescript
enum PermissionLevel {
  READ_ONLY = 0,   // read, ls, grep, tree, search_memory, read_memory, traverse_memory
  FILE_WRITE = 1,  // + write, cp, mv, save_memory, link_memory, forget_memory
  FULL = 2,        // + shell / background_shell (需确认)
}

// TUI 直连 Core → PermissionLevel.FULL
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [project-structure.md](./project-structure.md) | 模块目录布局 |
| [bootstrap.md](./bootstrap.md) | 启动序列 |
| [pipeline-dev.md](../core/pipeline-dev.md) | Pipeline 一览、Element 开发、Event Bus |
