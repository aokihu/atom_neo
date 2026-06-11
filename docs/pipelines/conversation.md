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

**职责**: 收集运行时上下文数据，注入长期记忆

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
      if (node.accessCount >= 5) continue;
      const aging = node.accessCount >= 3 ? ' aging="true"' : "";
      contextData += `\n<Memory id="${node.id.slice(0,6)}" tags="${node.tags}"${aging}>\n${node.content}\n</Memory>`;
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
  maxSteps: 5,
  maxTokens: input.maxTokens ?? 4096,
});
```

#### 滑动窗口 — `<<<COMPLETE>>>` 标记检测

```typescript
const MARKER = "<<<COMPLETE>>>";
const WINDOW = MARKER.length - 1;   // 始终保留最后 16 个字符
const TEXT_BUFFER_MAX = 3;          // 缓冲 N 个 chunk 再发送

let buffer = "";                     // 滑动窗口缓冲区
let textBuffer = "";                 // TUI 发送缓冲
let pastMarker = false;

for await (const chunk of streamResult.fullStream) {
  if (chunk.type !== "text-delta") continue;

  if (pastMarker) continue;         // 标记后内容丢弃

  buffer += chunk.textDelta;
  const idx = buffer.indexOf(MARKER);

  if (idx >= 0) {
    if (idx > 0) {
      textBuffer += buffer.slice(0, idx);
    }
    pastMarker = true;
    // 发送标记前的文本，日志记录 "complete-marker-detected"
    bus.emit("transport.delta", { textDelta: textBuffer });
    buffer = "";
    textBuffer = "";
  } else if (buffer.length > WINDOW) {
    const emitLen = buffer.length - WINDOW;
    textBuffer += buffer.slice(0, emitLen);
    buffer = buffer.slice(emitLen);

    if (textBuffer.length >= TEXT_BUFFER_MAX) {
      bus.emit("transport.delta", { textDelta: textBuffer });
      textBuffer = "";
    }
  }
}

// 流结束后刷新残留缓冲区
if (textBuffer || buffer) {
  bus.emit("transport.delta", { textDelta: textBuffer + buffer });
}
```

#### 关键设计点

| 机制 | 说明 |
|------|------|
| `WINDOW = 16` | 滑动窗口始终保留最后 16 个字符，用于检测 `<<<COMPLETE>>>`（17 字符）标记，确保标记不会被部分发送给 TUI |
| `TEXT_BUFFER_MAX = 3` | 缓冲 3 个 text-delta 后再发送 TUI，减少 WebSocket 消息量 |
| **Buffer 刷新** | 流结束后必须将 `buffer` 中残留字符刷新，否则末尾 ≤WINDOW 个字符会丢失 |
| **标记检测** | 命中 `<<<COMPLETE>>>` 后，发送标记前文本、丢弃后续内容、日志记录 `complete-marker-detected` |

### 4.6 `check-follow-up`

**kind**: `boundary`

**职责**: 消费 `input.intents[]`，按类型分派

- `FOLLOW_UP` → 设置 followUp data
- `KEEP_MEMORY` → 验证 mem_id 真实存在后执行 `memory.keep()`

**两阶段安全校验：**

| 阶段 | 位置 | 校验内容 |
|------|------|---------|
| parse | intent 解析阶段 | 格式校验：必需参数非空、未知 TYPE 跳过 |
| execute | CheckFollowUpElement | 存在性校验：mem_id 需在 MemoryService 中存在才执行 keep() |

### 4.7 `finalize` — 链任务统一收口

**kind**: `sink`

发出 `BusEvents.Conversation.Chain` 事件，server.ts 统一处理链式续写调度。

**chainDepth 防循环**: 上限 `maxChainDepth`（默认 5）。`check-follow-up` 判定 needFollowUp 时由 server.ts 检查 depth 是否超限。

**chainAction 设置顺序：**

| Element | 设置值 | 条件 |
|---------|--------|------|
| stream-llm | `"follow_up"` | finishReason === "length" / "tool-calls" / "error"(status<400)/意图包含 FOLLOW_UP |
| stream-llm | (跳过) | finishReason === "error" && errorStatusCode >= 400 — 参数错误不可恢复 |
| finalize | 跳过 Idle | errorStatusCode >= 400 — 不触发 post-conversation 分析 |

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
| `maxSteps` | `config.json → conversation.maxSteps` | `50` |
| `maxTokens` | `config.json → transport.maxOutputTokens` | `4096` |
| `tools` | 全部工具（启动时一次性加载），通过 `activeTools` 按 intent 过滤 | `createAllTools()` |
| `providerOptions` | `{ deepseek: { thinking: { type: ... } } }` | thinking=disabled |

**输出净化**：所有 LLM 输出在流式结束后经过 `sanitizeForJSON()` 双层净化：
1. `String.toWellFormed()` 修复非法 Unicode 代理对
2. 正则剥离字面量 `\uXXXX` 文本序列

**溢出检测**：`stepCount===0 && fullTextLen===0 && ratio > 0.8` 才判定 token 溢出，ratio ≤ 0.8 时报 `stream-error-not-overflow` 避免误判。

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
  maxTokens?: number;        // → stream-llm
  maxSteps?: number;         // → stream-llm
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
```

## 13. 相关文档

| 文档 | 说明 |
|------|------|
| [pipeline-dev.md](../core/pipeline-dev.md#part-1-element-design) | Element 接口和模板 |
| [pipeline-dev.md](../core/pipeline-dev.md#part-2-pipeline-builder) | Pipeline Builder DSL |
| [session.md](../core/session.md) | Per-Session 上下文 |
| [memory-service.md](../subsystems/memory-service.md) | Memory Service API |
| [pipelines/prompts.md](./prompts.md) | PromptRegistry 提示词统一管理 |
