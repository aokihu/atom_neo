# Message Organization

> **Purpose**: 定义提交给 LLM 的 Message 数组组织结构。
> 所有 Message 遵循 AI SDK `{ role, content }` 格式。

---

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
| 第 1 层 | 安全边界 | `src/assets/prompts/base_system_prompt.md` | 静态 import（打包时内联） |
| 第 2 层 | 上下文数据 | 运行时动态收集 | 时间、目录、长期记忆等 |

---

## 2. Element 链

```
collect-prompts    (source:    初始→streaming)
  → load-system-prompt  (transform: streaming→streaming，不切换mode)
  → fetch-agents-prompt (transform: streaming→streaming，不切换mode)
  → collect-context     (transform: streaming→streaming，不切换mode)
  → format-system-messages (transform: streaming→streaming，合并为 systemText)
  → format-user-messages   (transform: streaming→formatted，组装 userMessages)
  → stream-llm          (transform: formatted→executing，system + messages)
  → parse-intents       (transform: executing→executing，不切换mode)
  → check-follow-up     (boundary:  executing→ready_to_finalize，按intent分派)
  → finalize            (sink:      ready_to_finalize→PipelineResult)
```

**关键变化（v0.5.1）：**
- `parse-intents` 加回 — 纯正则解析 `responseText` → `FlowState.intents[]`
- `check-follow-up` 简化 — 消费 `input.intents[]`，按类型分派（FOLLOW_UP / KEEP_MEMORY）
- 不影响流式设计 — parse-intents 在 stream-llm 完成后执行，不切换 mode

---

## 3. Element 详解

### 3.1 `load-system-prompt`（新增）

**kind**: `transform`

**职责**: 加载 `src/assets/prompts/base_system_prompt.md`，写入 FlowState

```typescript
// Static import — Bun 原生支持 .md 作为文本，打包时内联
import baseSystemPrompt from "@assets/prompts/base_system_prompt.md";

class LoadSystemPromptElement extends BaseElement {
  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;
    return { ...input, systemPrompt: baseSystemPrompt };
  }
}
```

**关键设计**:
- 使用 `import ... from "*.md"` — Bun 原生将 `.md` 识别为 `string`
- 打包为二进制时内容直接内联，无需文件系统读取
- **不切换 mode**，streaming 保持不变

### 3.2 `collect-context`（新增）

**kind**: `transform`

**职责**: 收集运行时上下文数据

```typescript
class CollectContextElement extends BaseElement {
  async doProcess(input): Promise {
    if (input.mode !== "streaming") return input;

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

**未来扩展**:
- MemoryService 查询长期记忆，附加到 contextData
- SessionContext 中的 inference facts
- sandbox 目录结构快照

### 3.3 `format-system-messages`（新增，拆分自 format-messages）

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

### 3.4 `format-user-messages`（新增，拆分自 format-messages）

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

### 3.5 `parse-intents`（加回）

**kind**: `transform`，不切换 mode（executing → executing）

**职责**: 纯正则解析 `intentRequestText` → 结构化 `IntentRequest[]`，含格式安全校验

```typescript
function parseIntentRequests(text: string): IntentRequest[] {
  const intents: IntentRequest[] = [];
  const re = /\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const parts = match[1].split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const type = parts[0];
    const params: Record<string, string> = {};
    for (const kv of parts.slice(1)) {
      const [k, v] = kv.split("=", 2);
      if (k && v) params[k.trim()] = v.trim();
    }

    if (type === "KEEP_MEMORY" && validateKeepMemory(params))
      intents.push({ ... });
    else if (type === "FOLLOW_UP" && validateFollowUp(params))
      intents.push({ ... });
    // 未知 TYPE 被忽略，不生产 intent
  }
  return intents;
}
```

**安全校验**（parse 阶段 — 格式验证）：

| TYPE | 必须参数 | 规则 |
|------|---------|------|
| `KEEP_MEMORY` | `mem_id` | 非空字符串 |
| `FOLLOW_UP` | `next_prompt` 或 `history_abstract` 或 `summary` | 至少一个非空 |
| 其他 | — | **跳过**，不产生 intent |

**格式**: `[TYPE,key=value,...]` — 方括号包裹，完整闭合才解析（滑动窗口安全）

### 3.6 `check-follow-up` — 执行期存在性校验

**kind**: `boundary`，切换 mode（executing → ready_to_finalize）

**职责**: 消费 `input.intents[]`，按类型分派，KEEP_MEMORY 验证 mem_id 真实存在

```typescript
class CheckFollowUpElement extends BaseElement {
  async doProcess(input): Promise {
    for (const intent of input.intents ?? []) {
      // 存在性校验：KEEP_MEMORY 的 mem_id 必须在 MemoryService 中存在
      if (intent.request === KEEP_MEMORY && this.#memory) {
        const id = intent.params.id as string;
        if (id && this.#memory.has(id)) this.#memory.keep(id);
      }
      // FOLLOW_UP → 设置 followUp data
      if (intent.request === FOLLOW_UP) { ... }
      // REQUEST_MORE_TOOLS → 标记 needMoreTools
      if (intent.request === REQUEST_MORE_TOOLS) { needMoreTools = true; }
    }
  }
}
```

**两阶段安全校验总结**:

| 阶段 | 位置 | 校验内容 |
|------|------|---------|
| parse | `parseIntentRequests()` | 格式校验：`mem_id` 非空、`next_prompt`/`summary` 至少一个非空、未知 TYPE 跳过 |
| execute | `CheckFollowUpElement` | 存在性校验：`mem_id` 需在 MemoryService 中存在才执行 `keep()` |

### 3.7 `finalize`（重写）— 链任务统一收口

**kind**: `sink`，最后元素 — 消费 `chainAction` 并创建链任务

**职责**: 根据 `chainAction` 值创建对应链任务
- `"follow_up"` → 续写任务（payload: "请从上次中断处继续"）

```typescript
class FinalizeElement extends BaseElement {
  #queue: TaskQueue;

  async doProcess(input): Promise {
    if (input.chainAction === "follow_up") {
      const task = createTaskItem({
        source: INTERNAL,
        payload: [{ type: "text", data: "请从上次中断处继续" }],
        ...
      });
      this.#queue.enqueue(task);
    }

    return { type: "complete", task: input.task, output: input.responseText };
  }
}
```

**chainDepth 防循环**: `FinalizeElement` 注入 `chainDepth`，创建链任务时传递 `depth + 1`。上限 `MAX_FOLLOW_UP_DEPTH = 5`，到达上限停止创建链任务。

**扩展新链类型**: 加一个字符串值 + FinalizeElement 一个分支。不改 FlowState 字段，不改 server.ts。

**chainAction 设置顺序**（按 pipeline 执行序）:
| Element | 设置值 | 条件 |
|---------|--------|------|
| stream-llm | `"follow_up"` | finishReason === "length" |
| check-follow-up | `"more_tools"` | 覆盖（工具优先） |

---

## 4. FlowState 类型扩展

```typescript
type ConversationFlowState = {
  mode: "initial" | "streaming" | "formatted" | "executing" | "ready_to_finalize";
  task: TaskItem;
  // 新增
  systemPrompt?: string;           // load-system-prompt 写入
  compiledAgentsPrompt?: string;   // fetch-agents-prompt 写入
  contextData?: string;            // collect-context 写入
  systemText?: string;             // format-system-messages 写入（合并后）
  userMessages?: Message[];        // format-user-messages 写入（历史+当前）
  prompts?: PromptItem[];          // collect-prompts 写入（会话历史）
  responseText?: string;           // stream-llm 写入
  followUp?: FollowUpData;         // check-follow-up 写入
  chainAction?: "more_tools" | "follow_up";  // stream-llm / check-follow-up 写入
  intents?: IntentRequest[];        // parse-intents 写入
};
```

---

## 5. `stream-llm` — 流式输出 + `<<<REQUEST>>>` 标记检测

```typescript
// 门控
if (input.mode !== "formatted") return input;

// system 独立参数 — 消除 AI SDK 安全警告
const streamResult = streamText({
  model,
  system: input.systemText,        // ← 专用参数，不混在 messages 中
  messages: input.userMessages,    // ← 仅 user/assistant
  tools: aiTools,
  maxSteps: 5,
  maxTokens: input.maxTokens ?? 4096,
});

const MARKER = "<<<REQUEST>>>";
const WINDOW = MARKER.length - 1;   // 滑动窗口，始终保留最后 WINDOW 个字符
const CHUNK_BATCH = 3;              // 缓冲 N 个 chunk 再发送 TUI

let fullText = "";
let buffer = "";                     // 滑动窗口缓冲区
let pastMarker = false;
let intentRequestText = "";
let deltaBuffer = "";
let deltaCount = 0;

for await (const chunk of streamResult.fullStream) {
  if (chunk.type === "step-finish") {
    finishReason = (chunk as any).finishReason ?? "";
    continue;
  }
  if (chunk.type !== "text-delta") continue;

  // 已检测到标记 → 后续内容归入 intentRequestText
  if (pastMarker) {
    intentRequestText += chunk.textDelta;
    continue;
  }

  buffer += chunk.textDelta;
  const idx = buffer.indexOf(MARKER);

  if (idx >= 0) {
    // 找到标记 → 发送标记前的内容
    if (idx > 0) {
      fullText += buffer.slice(0, idx);
      deltaBuffer += buffer.slice(0, idx);
      deltaCount++;
    }
    intentRequestText = buffer.slice(idx + MARKER.length);
    pastMarker = true;
    buffer = "";
  } else if (buffer.length > WINDOW) {
    // 未找到标记 → 发送 WINDOW 之前的安全内容
    const emitLen = buffer.length - WINDOW;
    fullText += buffer.slice(0, emitLen);
    deltaBuffer += buffer.slice(0, emitLen);
    deltaCount++;
    buffer = buffer.slice(emitLen);   // 保留最后 WINDOW 个字符
  }

  // 累积 CHUNK_BATCH 个 chunk 后批量发送 TUI
  if (deltaCount >= CHUNK_BATCH && deltaBuffer) {
    bus.emit("transport.delta", { textDelta: deltaBuffer });
    deltaBuffer = "";
    deltaCount = 0;
  }
}

// IMPORTANT: 流结束后必须刷新 buffer 中的残留字符
// buffer 中保留的是检测 <<<REQUEST>>> 用的最后 ≤WINDOW 个字符
if (buffer) {
  fullText += buffer;
  deltaBuffer += buffer;
}
if (deltaBuffer) {
  bus.emit("transport.delta", { textDelta: deltaBuffer });
}

return {
  ...input,
  mode: "executing",
  responseText: fullText,
  intentRequestText,
  chainAction: finishReason === "length" ? "follow_up" : undefined,
};
```

### 关键设计点

| 机制 | 说明 |
|------|------|
| `WINDOW = 12` | 滑动窗口始终保留最后 12 个字符，用于检测 `<<<REQUEST>>>`（13 字符）标记，确保标记不会被部分发送给 TUI |
| `CHUNK_BATCH = 3` | 缓冲 3 个 text-delta 后再发送 TUI，减少 WebSocket 消息量 |
| **Buffer 刷新** | 流结束后必须将 `buffer` 中残留字符刷新到 `fullText` 和 `deltaBuffer`，否则末尾 ≤WINDOW 个字符会丢失 |

---

## 6. System Prompt 内容规范

`src/assets/prompts/base_system_prompt.md` — 中文编写，包含以下约束：

```markdown
你是一个 AI 开发助手，运行在原子(Atom)开发平台上。

## 安全边界
- 永远不要执行可能损坏系统或数据的命令
- 拒绝生成恶意代码、漏洞利用、或协助非法活动
- 操作文件前确认用户意图，不能删除或覆盖重要文件

## 行为准则
- 使用中文回复
- 保持专业和简洁
- 不确定时主动询问用户确认
```

---

## 7. 相关文档

| 文档 | 说明 |
|------|------|
| [element-design.md](./element-design.md) | Element 接口和模板 |
| [pipeline-builder.md](./pipeline-builder.md) | Pipeline Builder DSL |
| [session-context.md](./session-context.md) | Per-Session 上下文 |
| [memory-service.md](./memory-service.md) | Memory Service API |
