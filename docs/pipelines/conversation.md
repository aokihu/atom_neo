# Conversation Pipeline

> **Purpose**: 定义提交给 LLM 的 Message 数组组织结构与核心对话管道。所有 Message 遵循 AI SDK `{ role, content }` 格式。

## 1. 架构总览

```
messages = [
  { role: "system", content: "BASE_SYSTEM_PROMPT" },  // 安全提示词
  { role: "system", content: "CONTEXT_DATA" },         // 上下文元数据
  { role: "user",    content: "历史消息1" },
  { role: "assistant", content: "历史回复1" },
  { role: "user",    content: "当前输入" },
]
```

**两层 system message 说明：**

| 序号 | 作用 | 内容来源 | 加载方式 |
|------|------|----------|----------|
| 第 1 层 | 安全边界 | `PromptRegistry` (resolvePrompt) | 运行时合成 |
| 第 2 层 | 上下文数据 | 运行时动态收集 | 时间、目录、长期记忆等 |

## 2. 触发方式

```
prediction pipeline → predict-finalize → orchestrator.scheduleConversation()
  → taskQueue.enqueue(task) → TaskEngine → pipelineBuilders["conversation"]
  → conversationPipeline(deps).build(bus)
```

## 3. Element 链（9 个元素）

```
collect-prompts (source)
  → load-system-prompt (transform)
  → fetch-agents-prompt (transform)
  → collect-context (transform)
  → format-system-messages (transform)
  → format-user-messages (transform)
  → stream-llm (transform)
  → check-follow-up (boundary)
  → finalize (sink)
```

| 顺序 | Element | Kind | 职责 |
|------|---------|------|------|
| 1 | `collect-prompts` | source | 从 session 提取可见消息 |
| 2 | `load-system-prompt` | transform | 从 PromptRegistry 合成系统提示词 |
| 3 | `fetch-agents-prompt` | transform | 获取 Agent 编译器输出的指令 |
| 4 | `collect-context` | transform | 构建环境上下文（cwd、OS、记忆、token 使用、主题约束、任务进度、难度规则） |
| 5 | `format-system-messages` | transform | 合并 system prompt + agent prompt + context |
| 6 | `format-user-messages` | transform | 组装 user message 数组，切换 mode → `formatted` |
| 7 | `stream-llm` | transform | 核心：调用 LLM 流式生成 |
| 8 | `check-follow-up` | boundary | 根据意图和 finishReason 决定 chainAction |
| 9 | `finalize` | sink | 发出 `Conversation.Chain` 事件 → server.ts 统一调度 |

## 4. Element 详解

### 4.1 `load-system-prompt`

**kind**: `transform`

**职责**: 通过 `resolvePrompt()` 从 PromptRegistry 合成系统提示词（多语言 + 模型精细化追加）

```typescript
class LoadSystemPromptElement extends BaseElement {
  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;
    const systemPrompt = resolvePrompt(PromptKey.BASE_SYSTEM, input.providerModel);
    return { ...input, systemPrompt };
  }
}
```

- **不切换 mode**，streaming 保持不变

### 4.2 `collect-context`

**kind**: `transform`

**职责**: 收集运行时上下文数据，注入长期记忆、工具执行历史

```typescript
class CollectContextElement extends BaseElement {
  async doProcess(input): Promise {
    let contextData = [
      `Current Time: ${new Date().toISOString()}`,
      `Sandbox Directory: ${sandbox}`,
      `OS: ${process.platform} ${process.arch}`,
    ].join("\n");

    // Memory injection with <Memory> tags
    const memories = this.#memory?.search(input.task?.payload?.[0]?.data) || [];
    for (const node of memories) {
      if (node.accessCount >= 5) { this.#memory.decayWeight(node.id, 10); continue; }  // 高频记忆衰减
      const aging = node.accessCount >= 3 ? ' aging="true"' : "";                     // 中等频率标记老化
      contextData += `\n<Memory id="${node.id.slice(0,6)}" tags="${node.tags}"${aging}>\n${node.content}\n</Memory>`;
      this.#memory.incrementAccess(node.id);
      this.#memory.boostWeight(node.id);
    }

    // Tool execution history injection (from ToolContext)
    const results = this.#session.toolContext?.results ?? [];
    const topicResults = results.filter((r: any) => r.topic === this.#session.currentTopic);
    if (topicResults.length > 0) {
      const lines = topicResults.map((r: any) =>
        `- [${new Date(r.timestamp).toISOString().slice(11, 19)}] ${r.toolName}: ${r.ok ? "ok" : "error"}${r.output ? ` — ${r.output.slice(0, 80)}` : ""}`
      );
      contextData += `\n\n[Tool Execution History]\n${lines.join("\n")}`;
      this.#session.toolContext.results = results.filter((r: any) => r.topic !== this.#session.currentTopic);
    }

    return { ...input, contextData };
  }
}
```

### 4.3 `format-system-messages`

**kind**: `transform`

**职责**: 合并三个 system 层级，不切换 mode

```typescript
class FormatSystemMessagesElement extends BaseElement {
  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;
    const parts: string[] = [];
    if (input.systemPrompt) parts.push(input.systemPrompt);
    if (input.compiledAgentsPrompt) parts.push(input.compiledAgentsPrompt);
    if (input.contextData) parts.push(input.contextData);
    return { ...input, systemText: parts.join("\n\n") };
  }
}
```

### 4.4 `format-user-messages`

**kind**: `transform`

**职责**: 组装用户/助手消息，切换到 `formatted` mode

```typescript
class FormatUserMessagesElement extends BaseElement {
  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;
    const messages: Message[] = [];
    for (const m of input.prompts ?? []) {
      messages.push({ role: m.role, content: m.content });
    }
    const text = input.task?.payload?.[0]?.data;
    if (text) messages.push({ role: "user" as const, content: text });
    return { ...input, mode: "formatted", userMessages: messages };
  }
}
```

### 4.5 `stream-llm` — 核心流式生成

**kind**: `transform`

#### 门控与调用

```typescript
if (input.mode !== "formatted") return input;

const streamResult = streamText({
  model,
  system: input.systemText,        // ← 专用参数，不混在 messages 中
  messages: input.userMessages,    // ← 仅 user/assistant
  tools: aiTools,
  stopWhen: stepCountIs(this.#maxSteps),  // v6: 替代 maxSteps
  maxOutputTokens: this.#maxTokens,       // v6: 替代 maxTokens
  providerOptions: this.#providerOptions,
  abortSignal: abortController.signal,
  prepareStep: ({ stepNumber }) => {
    // 按 taskIntent 渐进式开放工具
    if (activeNames.length < tools.length) {
      return { activeTools: activeNames };
    }
  },
});
```

#### 滑动窗口 — `<<<COMPLETE>>>` 标记检测

```typescript
const MARKER = "<<<COMPLETE>>>";
const WINDOW = MARKER.length - 1;   // 始终保留最后 N-1 个字符
let buffer = "";                     // 滑动窗口缓冲区
let fullText = "";                   // 完整累计文本，用于计算 offset
let pastMarker = false;

for await (const chunk of streamResult.fullStream) {
  if (chunk.type !== "text-delta") continue;

  if (pastMarker) continue;         // 标记后内容丢弃

  buffer += chunk.textDelta;
  const idx = buffer.indexOf(MARKER);

  if (idx >= 0) {
    if (idx > 0) {
      const offset = fullText.length;
      const textDelta = buffer.slice(0, idx);
      fullText += textDelta;
      bus.emit("transport.delta", { textDelta, offset });
    }
    pastMarker = true;
    buffer = "";
    // 日志记录 "complete-marker-detected"
  } else if (buffer.length > MARKER.length * 3) {
    const sendLen = buffer.length - WINDOW;
    const textDelta = buffer.slice(0, sendLen);
    const offset = fullText.length;
    fullText += textDelta;
    bus.emit("transport.delta", { textDelta, offset });
    buffer = buffer.slice(-WINDOW);  // 保留 WINDOW 个字符，不与已发送内容重叠
  }
}

// 流结束后刷新残留缓冲区
if (!pastMarker && buffer.length > 0) {
  const offset = fullText.length;
  fullText += buffer;
  bus.emit("transport.delta", { textDelta: buffer, offset });
}
```

#### 关键设计点

| 机制 | 说明 |
|------|------|
| `WINDOW = MARKER.length - 1` | 滑动窗口始终保留最后 N-1 个字符，用于跨 chunk 检测 `<<<COMPLETE>>>` 标记。使用 `slice(-WINDOW)` 而非 `slice(-MARKER.length)` 避免与已发送内容产生 1 字符重叠 |
| `offset` | 每个 `transport.delta` 消息携带 `offset` 字段，表示该 delta 在完整文本中的起始位置。TUI 使用 `content.substring(0, offset) + textDelta` 组装消息，避免因消息乱序或 buffer 边界问题导致的字符重复 |
| **Buffer 刷新** | 流结束后必须将 `buffer` 中残留字符刷新，否则末尾 ≤WINDOW 个字符会丢失 |
| **标记检测** | 命中 `<<<COMPLETE>>>` 后，发送标记前文本、丢弃后续内容、日志记录 `complete-marker-detected` |

### 4.6 `check-follow-up`

**kind**: `boundary`

**职责**: 消费 `input.intents[]`，按类型分派

- `FOLLOW_UP` → 设置 followUp data
- `RETAIN_MEMORY` → 验证 mem_id 真实存在后执行 `memory.retain()`

**两阶段安全校验：**

| 阶段 | 位置 | 校验内容 |
|------|------|---------|
| parse | intent 解析阶段 | 格式校验：必需参数非空、未知 TYPE 跳过 |
| execute | CheckFollowUpElement | 存在性校验：mem_id 需在 MemoryService 中存在才执行 retain() |

### 4.7 `finalize` — 链任务统一收口

**kind**: `sink`

发出 `BusEvents.Conversation.Chain` 事件，server.ts 统一处理链式续写调度。

**chainDepth 防循环**: 上限 `maxChainDepth`（默认 5）。`check-follow-up` 判定 needFollowUp 时由 server.ts 检查 depth 是否超限。

**chainAction 设置顺序：**

| Element | 设置值 | 条件 |
|---------|--------|------|
| stream-llm | `"follow_up"` | finishReason === "length" / "error"(status<400) / 意图包含 FOLLOW_UP |
| stream-llm | (跳过) | finishReason === "error" && errorStatusCode >= 400 — 参数错误不可恢复 |
| finalize | 跳过 Idle | errorStatusCode >= 400 — 不触发 post-conversation 分析 |

> **v6 迁移说明**：`finishReason === "tool-calls"` 触发 follow_up 的逻辑已移除。v6 中 `stopWhen: stepCountIs(N)` 在工具循环内部自动处理，LLM 在生成文本前不会以 "tool-calls" 结束。

**Token 溢出压缩**：当 `tokenOverflow === true` 时，finalize 计算 `compressRatio` 并调用 `orchestrator.scheduleCompress()`：

```typescript
compressRatio = max(0, (tokenUsage / effectiveLimit - 0.8) * 5);
```

ratio 分为 5 档策略：

| ratio | keepCount | maxSummaryTokens |
|-------|-----------|------------------|
| < 0.3 | 20 | 400 |
| 0.3 - 0.6 | 10 | 600 |
| 0.6 - 0.9 | 5 | 800 |
| 0.9 - 1.2 | 2 | 1200 |
| >= 1.2 | 1 | 1600 |

**溢出检测防误判**：`stream-llm.ts` 在 `stepCount===0 && fullTextLen===0` 时额外检查 ratio 门控，只有 `ratio > 0.8` 才判定为真实 token 溢出，否则报 `stream-error-not-overflow`。

## 5. FlowState

```typescript
type ConversationMode =
  | "initial"
  | "streaming"
  | "formatted"
  | "executing"
  | "ready_to_finalize";

type ConversationFlowState = {
  mode: ConversationMode;
  task: any;
  prompts?: Array<{ role: string; content: string }>;
  systemPrompt?: string;
  compiledAgentsPrompt?: string;
  contextData?: string;
  systemText?: string;
  userMessages?: Message[];
  responseText?: string;
  reasoningContent?: string;
  followUp?: { summary: string; nextPrompt: string; avoidRepeat: string };
  chainAction?: "follow_up";
  intents?: IntentRequest[];
  tokenUsage?: TokenUsage;
  tokenOverflow?: boolean;
  errorStatusCode?: number;  // API 错误状态码，用于判断是否可恢复
};
```

## 6. 状态转移

```
initial
  → collect-prompts:      过滤可见消息                    → streaming
  → load-system-prompt:   合成系统提示词                   → streaming
  → fetch-agents-prompt:  获取编译后的 agent 指令           → streaming
  → collect-context:      构建环境上下文                    → streaming
  → format-system-messages: 合并 system + agent + context   → streaming
  → format-user-messages: 组装 user messages, mode 切换     → formatted
  → stream-llm:           调用 LLM, 处理 intent 工具调用     → executing
  → check-follow-up:      决定 chainAction                  → ready_to_finalize
  → finalize:             发出 Chain 或 Idle 事件           → PipelineResult
```

## 7. stream-llm AI SDK 配置

| 参数 | 来源 | 默认 |
|------|------|------|
| `model` | `runtime.getResolvedModel(difficulty).model` | `"deepseek-v4-flash"` |
| `stopWhen` | `config.json → conversation.maxSteps` → `stepCountIs(N)` | `stepCountIs(50)` |
| `maxOutputTokens` | `config.json → transport.maxOutputTokens` | `4096` |
| `tools` | 全部工具（启动时一次性加载），通过 `prepareStep.activeTools` 按 intent 过滤 | `createAllTools()` |
| `providerOptions` | `{ deepseek: { thinking: { type: ... } } }` | thinking=disabled |

> **v6 迁移说明**：`maxSteps` 已移除，改用 `stopWhen: stepCountIs(N)` 控制多步工具循环。`maxTokens` 已更名为 `maxOutputTokens`。`allowSystemInMessages` 已废弃（v6 中 system message 始终允许）。

**输出净化**：所有 LLM 输出在流式结束后经过 `sanitizeForJSON()` 双层净化：
1. `String.toWellFormed()` 修复非法 Unicode 代理对
2. 正则剥离字面量 `\uXXXX` 文本序列

**溢出检测**：`stepCount===0 && fullTextLen===0 && ratio > 0.8` 才判定 token 溢出，ratio ≤ 0.8 时报 `stream-error-not-overflow` 避免误判。

**Reasoning 流式处理（v6）**：`stream-llm.ts` 在流循环中处理以下 reasoning chunk 类型：

| chunk type | 处理 | 说明 |
|------------|------|------|
| `reasoning-start` | 跳过 | 推理块起始信号 |
| `reasoning-delta` | 累加 `reasoningText` | 流式推理文本增量 |
| `reasoning-end` | 跳过 | 推理块结束信号 |
| `text-start` / `text-end` | 跳过 | 文本块边界信号（v6 新增） |

推理内容在流循环结束后直接使用累积的 `reasoningText` 填充 `ConversationFlowState.reasoningContent`，替代了 v4 中从 `response.messages` 后置提取的方式。多步 tool calling 场景中，每步的 reasoning 都会被正确累加。当 `config.json` 中 `thinking` 为 `enabled` 或 `adaptive` 时生效。

**400 错误捕获**：`stream-llm.ts` 在 `type === "error"` 的 chunk 处理中提取 `err.statusCode` 存入 `streamErrorCode`。该变量在流循环结束后用于 `chainAction` 决策：

```
finishReason === "error" && streamErrorCode < 400 → chainAction: "follow_up" (可恢复)
finishReason === "error" && streamErrorCode >= 400 → chainAction: undefined (参数错误，不可恢复)
outer catch block → err.statusCode ?? 0 → errorStatusCode 字段
```

`errorStatusCode` 通过 `ConversationFlowState` 传至 `finalize.ts`，≥400 时跳过 `Conversation.Idle` 发射，阻断 post-conversation 对空输出的分析。

**工具调用流式传输（v6）**：AI SDK v6 新增工具参数流式 chunk 类型，模型逐字符生成工具参数时实时传输：

| chunk type | 处理 | 说明 |
|------------|------|------|
| `tool-input-start` | 记录 toolCallId + toolName | 模型开始构建工具参数 |
| `tool-input-delta` | 累加 `delta` 文本 | 工具参数增量文本，用于 TUI 流式展示参数构建过程 |
| `tool-input-end` | 标记参数构建完成 | 工具参数流式传输结束 |
| `tool-input-available` | debug 记录 | 工具输入完整可用 |
| `tool-input-error` | warn 记录 | 工具输入流式错误 |

完整工具调用流（v6）：
```
tool-input-start → tool-input-delta × N → tool-input-end → tool-call → tool-result
```

**Transport 事件桥接**：stream-llm.ts 在工具调用和结果到达时发送 bus 事件，server.ts 桥接到 WebSocket 广播给 TUI：

| 时机 | Bus Event | WebSocket Message |
|------|-----------|-------------------|
| `tool-call` chunk 到达 | `Transport.ToolStarted` | `TransportToolStarted` |
| `tool-result` chunk 到达 | `Transport.ToolFinished` | `TransportToolFinished` |

TUI 通过 `ToolMessageBox` 组件展示工具调用状态（preparing → executing → done/error），使用 `toolCallId` 作为主键匹配更新。

**Step 结束折叠**：每个 step 中全部工具调用完成后，`finish-step` chunk 触发 `Transport.ToolStepFinished` 事件，TUI 将当前 step 内所有独立 tool 消息折叠为一条 `tool-summary`：

| 时机 | Bus Event | WebSocket Message |
|------|-----------|-------------------|
| `finish-step` chunk | `Transport.ToolStepFinished` | `transport.tool.step-finished` |

摘要格式：
```
◆ 2 tools ✓ — search_memory, webfetch         ← 全部成功
◆ 3 tools (2 ok, 1 fail) — bash, webfetch, read  ← 部分失败
◆ 1 tool ✓ — bash                              ← 单工具也折叠
```

**工具结果上下文存储**：工具执行结果不存入 SessionMessage（避免 `role:"tool"` 孤立消息导致 API 400），而是存入 `SessionContext.toolContext.results`（`ToolResultEntry[]`），在下一轮 `collect-context` 时按 topic 过滤注入系统 prompt：

| 字段 | 类型 | 说明 |
|------|------|------|
| `toolName` | `string` | 工具名 |
| `topic` | `string` | 执行时的 `session.currentTopic` |
| `timestamp` | `number` | Unix ms 执行时间 |
| `ok` | `boolean` | 执行成功/失败 |
| `output` | `string` | 结果内容 |
| `durationMs` | `number?` | 执行耗时 |

数据流：
```
工具执行完成 → session.addToolResult({ toolName, topic, timestamp, ok, output })
  → toolContext.results 按 topic 累积
  → 下一轮 collect-context: 过滤当前 topic → 格式化为 [Tool Execution History]
  → 注入 contextData → 清除当前 topic 条目
  → resetForNewTopic() 时全量清空
```

上下文展示格式：
```
[Tool Execution History]
- [11:30:21] search_memory: ok — No memories found
- [11:30:24] webfetch: ok — Weather data (1.2KB)
```

`format-user-messages.ts` 中设有防线 `if (m.role === "tool") continue`，确保孤立的 `role:"tool"` 消息不会进入 LLM 消息数组。

**Chunk 类型全覆盖**：v6 完整 chunk 类型清单及处理策略：

| 类别 | Chunk 类型 | 处理方式 |
|------|-----------|----------|
| 跳过 | `stream-start`, `response-metadata`, `message-metadata`, `source`, `source-document`, `source-url`, `object`, `raw`, `reasoning`, `all` | `continue` |
| Debug | `tool-input-start`, `tool-input-delta`, `tool-input-end`, `tool-input-available`, `tool-output-available`, `file`, `dynamic-tool` | `Element.Data` debug 级别 |
| Warn | `tool-input-error`, `tool-output-denied`, `tool-output-error`, `tool-approval-request`, `abort` | `Element.Data` warn 级别 |
| Error | `tool-error` | `Element.Data` error 级别 |

不再有任何 chunk 类型落入 `unhandled-chunk` 兜底。

## 8. chainAction → 链式续写

finalize element 发出 `BusEvents.Conversation.Chain` 事件，server.ts 统一处理：

```
Conversation.Chain handler:
  ├── post_check_retry + depth >= maxChainDepth → 终止链
  ├── post_check_retry → incrementChainDepth + scheduleFollowUp
  ├── hasActiveTodos → incrementChainDepth + scheduleFollowUp (跳过 evaluator)
  ├── follow_up + depth >= maxChainDepth → scheduleEvaluator
  ├── follow_up + depth >= 3 && depth % 3 === 0 → scheduleEvaluator
  └── follow_up → incrementChainDepth + scheduleFollowUp
```

**400 错误防护**：`stream-llm.ts` 在 `finishReason === "error"` 且 `errorStatusCode >= 400` 时不设置 `chainAction`（参数错误不可恢复）。`finalize.ts` 在 `errorStatusCode >= 400` 时不发射 `Conversation.Idle`，阻断 post-conversation 对空输出的分析。

## 9. TODO 顺序执行机制

### 三层约束

| 层 | 实现 | 效果 |
|----|------|------|
| **工具级强约束** | `todowrite` 执行前检查 `in_progress` 数量，>1 返回错误 | 即时反馈，无法绕过 |
| **Prompt 威慑** | Step 0 + 执行规则中声明 "todowrite 会拒绝多个 in_progress" | 事前提防 |
| **上下文警告** | `collect-context` 在 TODO 列表上方注入醒目横幅 | 每次交互提醒 |

### 执行模式

```
LLM 调用 todowrite (1个 in_progress) → 执行当前任务 → 完成
  → todowrite (标记 completed + 设置下一个 pending 为 in_progress)
  → intent (action: follow_up)  // 系统接管，继续下一个
```

### `post_check_retry` 链深度限制

post-conversation 判定 `blocked` 时触发 `post_check_retry`。server.ts 中该分支新增 `chainDepth >= maxChainDepth` 门控，防止消息损坏导致的无限重试循环。

### todowrite 工具 Schema

`todowrite` 工具定义在 `src/packages/core/src/tools/builtin/todowrite.ts`。

```typescript
TodoWriteInputSchema = z.object({
  todos: z.array(TodoItemSchema).describe("Full task list to replace current state"),
});

TodoItemSchema = z.object({
  content: z.string().describe("Task description"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["high", "medium", "low"]),
});
```

**全量替换模式**：LLM 每次调用必须传入完整 todo 数组（包括已完成和待处理项），彻底替换 `session.todoState`。现有状态由 `stream-llm.ts` 在工具执行成功后自动同步：

```typescript
if (t.name === "todowrite" && r.ok && session?.setTodoState) {
    session.setTodoState((args as any).todos ?? []);
}
```

**工具级验证**：`execute` 函数统计 `in_progress === "in_progress"` 的数量，> 1 时返回 `{ ok: false, error: "..." }`。`r.ok === false` 时不会同步到 session。

**formatProgress() 输出**：使用 Unicode 图标格式化进度（⬜/🔄/✅/❌），包含编号和优先级，末尾显示"下一步"提示。

## 10. Unicode 净化（sanitizeForJSON）

所有 LLM 输出的文本在存储前经过双层净化，防止模型输出的非法 Unicode 字符污染会话历史导致后续 API 400 错误：

| 层 | 技术 | 处理目标 |
|----|------|----------|
| **第 1 层** | `String.toWellFormed()` (ES2024) | 孤立代理 codepoint → U+FFFD |
| **第 2 层** | 正则 `\\u[0-9a-fA-F]{0,4}` | 字面量 `\uXXXX` 文本序列 → decode/strip |

净化点：
- `stream-llm.ts` — `fullText` 返回前（源头）
- `server.ts` — assistant message 存储前（防线）

共享工具函数 `sanitizeForJSON` 定义在 `@atom-neo/shared`。

## 11. Deps

```typescript
type ConversationPipelineDeps = {
  session: any;              // → collect-prompts, collect-context
  task: any;                 // → collect-prompts (sandbox)
  apiKey?: string;           // → stream-llm
  model?: string;            // → stream-llm
  baseUrl?: string;          // → stream-llm
  providerOptions?: Record<string, any>;  // → stream-llm
  providerModel?: string;    // → collect-context
  configContextLimit?: number; // → collect-context
  tools: any[];              // → stream-llm (全量工具)
  getCompiledPrompt?: () => string;  // → fetch-agents-prompt
  maxOutputTokens?: number;    // → stream-llm
  maxSteps?: number;           // → stream-llm (→ stepCountIs(maxSteps))
  memory?: any;              // → collect-context, check-follow-up
  taskIntent?: string;       // → stream-llm (filter by intent type)
  contextRelevance?: string; // → collect-prompts
  sandbox?: string;          // → collect-context
};
```

## 12. 文件

```
src/packages/core/src/pipelines/conversation/
  index.ts                          pipeline 定义 + deps 类型
  elements/
    types.ts                        ConversationFlowState
    index.ts                        barrel export
    collect-prompts.ts
    load-system-prompt.ts
    fetch-agents-prompt.ts
    collect-context.ts
    format-system-messages.ts
    format-user-messages.ts
    stream-llm.ts
    check-follow-up.ts
    finalize.ts

src/packages/shared/src/types/session.ts    SessionMessage, ToolContext, ToolResultEntry 类型定义
src/packages/core/src/session/context.ts     SessionContext, addToolResult()
src/packages/core/src/server.ts             Transport.ToolStarted/Finished WebSocket 桥接
src/packages/tui/src/
  components/ToolMessageBox.tsx              工具调用多阶段展示组件
  hooks/useChat.ts                           toolCallId 键控消息更新
  client/ws-client.ts                        TransportToolStarted/Finished 事件接收
  types.ts                                   ToolMessage phase 类型
```

## 13. Token Ratio 共享边界

`TokenRatioElement`（kind: `boundary`）定义在 `src/packages/core/src/pipelines/shared/token-ratio.ts`，通过 `registerSharedElements()` 在 `server.ts` 启动时统一挂载到 5 条 pipeline：

| Pipeline | 用途 |
|----------|------|
| conversation | 每轮对话结束后计算 token 占用比 |
| prediction | 意图分类后更新 token 统计 |
| follow-up-evaluator | 评估时检查是否需要压缩 |
| context-compress | 压缩流程中的 token 追踪 |
| post-conversation | 分析时的 token 统计 |

**计算公式**：

```typescript
const tu = session.tokenUsage.total + (input.tokenUsage?.total ?? 0);
const effectiveLimit = configContextLimit - maxTokens;
const ratio = effectiveLimit > 0 ? tu / effectiveLimit : 0;
```

`effectiveLimit` 为真实可用 token 上限（配置的 contextLimit 减去 maxTokens 输出预留空间）。ratio 值通过 `BusEvents.Element.Data` 上报，供日志和下游元素消费。

**日志格式**：`token-ratio: token-ratio {"tu": N, "effectiveLimit": N, "ratio": X.XXXX}`

## 14. intent 工具 Schema

`intent` 工具定义在 `src/packages/core/src/tools/builtin/intent.ts`，是 LLM 与系统之间的信令通道。

### Schema

```typescript
IntentInputSchema = z.object({
  action: z.enum(["follow_up", "retain_memory"]),
  mem_id: z.string().optional(),           // retain_memory 时指定目标记忆 ID
  next_prompt: z.string().optional(),      // follow_up 时指定下一个片段的提示
  summary: z.string().optional(),          // 当前片段的简短摘要
  history_abstract: z.string().optional(), // 对话历史概要
  avoid_repeat: z.string().optional(),     // 要避免重复的已输出内容
});
```

### 字段说明

| 字段 | action | 说明 |
|------|--------|------|
| `action` | 两者 | `follow_up`（分段续写）或 `retain_memory`（保留已有记忆） |
| `mem_id` | `retain_memory` | 要保留的记忆 ID（来自 `search_memory` 或 `<Memory id="...">`） |
| `next_prompt` | `follow_up` | 下一段续写的方向提示（如 "继续输出第3段"） |
| `summary` | `follow_up` | 当前段的摘要，供下次续写时上下文注入 |
| `history_abstract` | 两者 | 对话历史的简短概括 |
| `avoid_repeat` | `follow_up` | 提示续写时不要重复已输出的内容 |

### 工具属性

| 属性 | 值 | 说明 |
|------|-----|------|
| `silent` | `true` | 工具输出不向用户展示（仅系统内传播） |
| `permission` | `READ_ONLY` | 无需审批 |
| `execute` | 返回 `"信号已收到"` | 空操作 — 真正逻辑在 stream-llm.ts 和 check-follow-up.ts 中 |

### 处理链路

```
LLM 调用 intent → stream-llm 捕获 (intentSignal)
  → toIntentRequest() → intents[]
    → check-follow-up:
      ├── RETAIN_MEMORY → memory.retain(mem_id)
      └── FOLLOW_UP  → chainAction: "follow_up" + followUp data
```

**注意**：`intent` 调用后 LLM 应**立即停止输出**。在对话决策协议中，调用 intent 是终结点。

## 15. 相关文档

| 文档 | 说明 |
|------|------|
| [pipeline-dev.md](../core/pipeline-dev.md#part-1-element-design) | Element 接口和模板 |
| [pipeline-dev.md](../core/pipeline-dev.md#part-2-pipeline-builder) | Pipeline Builder DSL |
| [session.md](../core/session.md) | Per-Session 上下文 |
| [memory-service.md](../subsystems/memory-service.md) | Memory Service API |
| [pipelines/prompts.md](./prompts.md) | PromptRegistry 提示词统一管理 |
