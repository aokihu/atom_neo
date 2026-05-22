# Atom Next v2 — System Architecture

> **Purpose**: Agent development reference. For visualizations, see `docs/architecture.html` (pure HTML + Mermaid CDN).

---

## 1. 从 v1 到 v2：核心变化

| 维度 | v1 | v2 | 为什么 |
|------|----|----|--------|
| **任务调度** | `Core.runloop()` 轮询队列，sleep(500) | 事件驱动：task 入队 → 立即触发 pipeline | 无空转延迟，响应时间 O(1) |
| **上下文管理** | 全局 `ContextManager` (1299 行单体) | Per-Session 隔离，每个 session 独立实例 | 多 session 并发安全，无需全局锁 |
| **Memory 操作** | 独立 `memory-search` pipeline，4 个 Element | `search_memory` / `save_memory` 注册为 Tool | 统一工具调用路径，减少 2 条 pipeline |
| **LLM 输出解析** | 字符串 `<<<REQUEST>>>` 标签 + 正则提取 JSON | `streamText` + tool calling（流式输出 + 结构化工具调用）；IntentRequest 仅保留 `follow_up`（尾部隐蔽解析） | 流式体验 + 零解析错误 |
| **Pipeline 组装** | 硬编码 5 条 pipeline 定义 | 声明式 `PipelineBuilder`，Element 通过名称引用 | 热重载，运行时注册新 pipeline |
| **通信** | 进程中 `EventEmitter` | WebSocket 事件流（Core → Client 单向广播） | 可观测，可录制，可重放 |
| **调试** | 日志写入文件 + `registerDebugListeners` | Pipeline Replay — 完整执行记录，可回溯 | 问题复现成本降为 0 |
| **运行时架构** | 单体 `Runtime` (1210 行) | 微内核 + 插件：Orchestrator + IntentPolicy + ToolCoordinator + MemoryManager | 职责单一，可独立测试 |

---

## 2. 系统架构

### 2.1 三层模型

```text
┌─────────────────────────────────────────────────────┐
│                   TUI (Root)                         │
│   本地终端，直连 Core，WebSocket，root 权限          │
├─────────────────────────────────────────────────────┤
│                   Gateway                            │
│   JWT 认证 → 权限检查 → 速率限制 → 请求转发         │
├─────────────────────────────────────────────────────┤
│                    Core                              │
│   HTTP Server ── Pipeline Bus ── Tool Registry      │
│       │               │              │              │
│   Task Engine    Event Stream    Memory Plugin      │
│   (事件驱动)     (WebSocket)     (File/Bash/Memory) │
└─────────────────────────────────────────────────────┘
```

**关键区别于 v1：**
- Core 不轮询队列 → 事件驱动激活
- 每个 session 独立的 Context 实例 → 无状态共享
- Memory 是 Tool Plugin → 走统一调用路径
- 所有通信走 WebSocket 事件流 → 全域可观测

### 2.2 模块结构

```text
atom_next_v2/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── server.ts           # HTTP + WebSocket 服务器
│   │   │   ├── task-engine.ts      # 事件驱动任务引擎（替代 runloop）
│   │   │   ├── pipeline/           # 移植自 v1，精简
│   │   │   │   ├── runner.ts
│   │   │   │   ├── event-bus.ts
│   │   │   │   ├── base-element.ts
│   │   │   │   ├── builder.ts      # 【新】声明式 PipelineBuilder
│   │   │   │   └── elements/       # 共享 Element
│   │   │   ├── session/            # 【新】Per-Session 上下文
│   │   │   │   ├── context.ts      # SessionContext（替代 ContextManager）
│   │   │   │   └── store.ts        # Session 存储
│   │   │   ├── tools/              # 【新】Tool 插件系统
│   │   │   │   ├── registry.ts     # 动态注册/卸载
│   │   │   │   ├── definition.ts   # Tool 定义规范
│   │   │   │   ├── builtin/
│   │   │   │   │   ├── fs.ts       # read/ls/write/cp/mv
│   │   │   │   │   ├── bash.ts     # 受控 shell
│   │   │   │   │   └── memory.ts   # 【新】search/save/traverse/link
│   │   │   │   └── executor.ts
│   │   │   ├── replay/             # 【新】Pipeline 录制与重放
│   │   │   │   ├── recorder.ts
│   │   │   │   └── player.ts
│   │   │   └── pipelines/          # Pipeline 定义（DSL 组装，非硬编码）
│   │   │       ├── conversation.ts
│   │   │       ├── prediction.ts
│   │   │       └── follow-up.ts
│   │   └── package.json
│   │
│   ├── gateway/
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── auth/jwt.ts
│   │   │   ├── permission/checker.ts
│   │   │   └── proxy/core-proxy.ts
│   │   └── package.json
│   │
│   ├── tui/
│   │   ├── src/
│   │   │   ├── app.tsx
│   │   │   ├── session.ts
│   │   │   └── ws-client.ts
│   │   └── package.json
│   │
│   └── shared/
│       ├── src/
│       │   ├── types/              # Task, Intent, Tool, Pipeline 类型
│       │   ├── log/                # Hub-and-Sink 日志系统
│       │   └── protocol.ts         # WebSocket 事件类型定义
│       └── package.json
│
└── docs/
    ├── architecture.md
    └── architecture.html
```

---

## 3. 核心创新详解

### 3.1 事件驱动调度（替代 Core.runloop）

```typescript
// v1: 轮询
while (true) {
  if (queue.isEmpty) { await sleep(500); continue; }
  await runActivatedTask();
}

// v2: 事件驱动
class TaskEngine {
  constructor(bus: PipelineEventBus) {
    bus.on("task.enqueued", (task) => this.onTaskEnqueued(task));
    bus.on("pipeline.finished", (result) => this.onPipelineFinished(result));
    bus.on("pipeline.failed", (error) => this.onPipelineFailed(error));
  }

  private onTaskEnqueued(task: TaskItem) {
    if (!this.running) {
      this.runNext();
    }
  }
}
```

**优势：** 无空转等待，任务到达即处理，天然支持并发 pipeline。

### 3.2 Per-Session 上下文隔离

```typescript
// v1: 全局 ContextManager
class ContextManager {
  // 一个实例管理所有 session 的状态
  private state: RuntimeContext; // monolith
}

// v2: Per-Session
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

### 3.3 声明式 Pipeline Builder（替代硬编码）

```typescript
// v1: 硬编码
new CollectPromptsElement({ ctx, runtime }),
new FormatMessagesElement({ ctx, runtime, transportConfig }),
new StreamLLMElement(ctx, serviceManager),

// v2: 声明式
const conversationPipeline = pipeline("conversation")
  .source("collect-prompts", { runtime })
  .transform("format-messages", { runtime, config: transportConfig })
  .transform("stream-llm", { serviceManager, tools, bus })  // streamText + tool calling
  .boundary("check-follow-up")  // 解析 follow_up IntentRequest
  .sink("finalize", { runtime })
  .build();
```

**优势：** 运行时注册新 pipeline，支持热重载，Element 按名称查找而非硬编码 import。

### 3.4 Streaming + Tool Calling + IntentRequest

```typescript
// 核心：streamText 提供流式输出 + 结构化工具调用
const result = streamText({
  model,
  messages: buildMessages(task),
  tools: convertToAISDKTools(toolRegistry.getTools()),  // read, write, bash, search_memory 等
  onChunk({ chunk }) {
    if (chunk.type === "text-delta") {
      bus.emit("transport.delta", { taskId: task.id, textDelta: chunk.textDelta });
    }
  },
  onFinish({ response }) {
    // 工具调用已完成（融入对话）
    // 流结束后，从完整响应文本解析 follow_up IntentRequest
    const fullText = response.text;
    const intents = parseIntentRequests(fullText);  // 仅解析 FOLLOW_UP
    if (intents.some(i => i.request === IntentRequestType.FOLLOW_UP)) {
      ctx.setContinuationContext({ ... });
    }
  },
});
```

**两条路径分工：**
| 机制 | 工具 | 用户感知 | 时机 |
|------|------|----------|------|
| `streamText` tool calling | read, write, bash, search_memory 等 | ✅ 可见，正常反馈 | 流式输出中 |
| IntentRequest 解析 | 仅 `follow_up` | ❌ 无感，隐蔽调度 | 流结束后 |

**优势：** 流式逐字输出 + 工具调用不打断阅读 + follow_up 隐蔽执行，用户无感知。

### 3.5 Pipeline Replay（录制与重放）

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

### 4.1 v1 vs v2 Pipeline 数量

| v1 Pipeline | v2 对应 | 说明 |
|-------------|---------|------|
| `formal-conversation` | `conversation` | 保留，Element 链用 Builder 组装 |
| `user-intent-prediction` | `prediction` | 保留，改为 tool calling 流式输出 |
| `post-follow-up` | `follow-up` | 保留 |
| `memory-search` | **不存在** | 改为 Tool Plugin: `search_memory` |
| `tool-execution` | **不存在** | 工具调用在 pipeline 内完成，不跳转管线 |

**v1: 5 条 pipeline → v2: 3 条 pipeline**

### 4.2 Tool Plugin 接口

```typescript
// packages/shared/src/types/tool.ts

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
  bashTool,        // 需确认
  searchMemoryTool, saveMemoryTool, traverseMemoryTool, linkMemoryTool, recallMemoryTool,
];
```

### 4.3 Pipeline Builder DSL

```typescript
// packages/core/src/pipeline/builder.ts

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
elementRegistry.set("format-messages", FormatMessagesElement);
elementRegistry.set("stream-llm", StreamLLMElement);
elementRegistry.set("check-follow-up", CheckFollowUpElement);
elementRegistry.set("finalize", FinalizeConversationElement);

// 使用
const pipeline = pipeline("conversation")
  .source("collect-prompts", { runtime })
  .transform("format-messages", { runtime, config })
  .transform("stream-llm", { serviceManager, tools, bus })  // streamText + tool calling
  .boundary("check-follow-up")  // 解析 follow_up IntentRequest
  .sink("finalize", { runtime })
  .build();
```

---

## 5. WebSocket 事件协议

```typescript
// packages/shared/src/protocol.ts

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

所有事件统一走 WebSocket，无 HTTP 轮询。Gateway 代理 WebSocket 连接。

---

## 6. HTTP API（Core）

```
POST   /api/tasks              → 提交任务（返回 taskId）
GET    /api/tasks/:id          → 查询任务状态
DELETE /api/tasks/:id          → 取消任务
WS     /ws/:sessionId          → WebSocket 事件流（双向）
GET    /api/health             → 健康检查
GET    /api/metrics            → 运行时指标
```

---

## 7. 权限模型

```typescript
enum PermissionLevel {
  READ_ONLY = 0,   // read, ls, grep, tree, search_memory, traverse_memory
  FILE_WRITE = 1,  // + write, cp, mv, save_memory, link_memory
  FULL = 2,        // + bash (需确认)
}

// TUI 直连 Core → PermissionLevel.FULL
// Gateway → JWT claim 中的 permission_level
// 不满足权限的 tool 调用在 Gateway 层被剥离
```

---

## 8. 实现计划

| 阶段 | 内容 | 预估 |
|------|------|------|
| **P1: 基础设施** | `shared/` 类型 + Pipeline 核心 + 日志系统 | 1 周 |
| **P2: Core 引擎** | 事件驱动调度器 + Per-Session 上下文 + Tool Registry | 1.5 周 |
| **P3: Tool 插件** | 文件系统 tools + Memory tools + Bash tool | 1 周 |
| **P4: Pipeline Builder** | Builder DSL + Element 注册表 + 3 条 pipeline | 1.5 周 |
| **P5: Core HTTP + WS** | 服务器 + WebSocket 事件协议 + Replay 系统 | 1 周 |
| **P6: Gateway** | Auth + 权限 + 速率限制 + 代理 | 0.5 周 |
| **P7: TUI** | WebSocket 客户端 + 流式渲染 + Session 管理 | 1 周 |
| **P8: 集成** | E2E 测试 + 文档 + 部署配置 | 0.5 周 |

**总计：约 8 周**

---

## 9. v1 → v2 迁移对照表

| v1 | v2 | 变化 |
|----|----|------|
| `Core.runloop()` 轮询 | `TaskEngine` 事件驱动 | 无空转延迟 |
| `ContextManager` (1299 行) | `SessionContext` (per-session) | 隔离、并发安全 |
| `Runtime` (1210 行) | 4 个拆分类 | 单职责 |
| `memory-search` pipeline | `memory.ts` Tool 插件 | 去 pipeline 化 |
| `tool-execution` pipeline | pipeline 内工具调用 | 不跳转管线 |
| `<<<REQUEST>>>` 标签解析 | AI SDK `streamText` + tool calling | 流式体验 + 结构化工具 |
| 硬编码 `new Element()` | `PipelineBuilder` DSL | 可热加载 |
| 进程内 `EventEmitter` | WebSocket 事件协议 | 可录制重放 |
| `registerDebugListeners` 日志 | + Pipeline Replay | 可回溯 |
| 单包 | Monorepo (4 packages) | 模块隔离 |
