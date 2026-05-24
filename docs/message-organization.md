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
- `check-follow-up` 简化 — 消费 `input.intents[]`，按类型分派（FOLLOW_UP / KEEP_MEMORY / REQUEST_MORE_TOOLS）
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

**职责**: 纯正则解析 `responseText` → 结构化 `IntentRequest[]`

```typescript
class ParseIntentsElement extends BaseElement {
  async doProcess(input): Promise {
    if (input.mode !== "executing") return input;
    const intents = parseIntentRequests(input.responseText);
    return { ...input, intents };
  }
}

function parseIntentRequests(text: string): IntentRequest[] {
  const intents: IntentRequest[] = [];
  if (/follow.?up|FOLLOW_UP|继续追问/i.test(text))
    intents.push({ request: FOLLOW_UP, params: {} });
  if (/REQUEST_MORE_TOOLS|需要更多工具/i.test(text))
    intents.push({ request: REQUEST_MORE_TOOLS, params: {} });
  const keep = text.match(/KEEP_MEMORY:(\w+)/i);
  if (keep) intents.push({ request: KEEP_MEMORY, params: { id: keep[1] } });
  return intents;
}
```

**关键设计**: 零外部依赖，纯文本函数。单元测试只需一段字符串。

**关键变化**: `mode` 从 `streaming` 切到 `formatted`，`stream-llm` 门控对应更新

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
  needMoreTools?: boolean;         // check-follow-up 写入
  intents?: IntentRequest[];        // parse-intents 写入
};
```

---

## 5. `stream-llm` — system 参数修复

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

let fullText = "";
for await (const chunk of streamResult.fullStream) {
  if (chunk.type === "text-delta") {
    fullText += chunk.textDelta;
    bus.emit("transport.delta", { textDelta: chunk.textDelta });
  }
}

return { ...input, responseText: fullText };
```

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
