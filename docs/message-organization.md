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
  → collect-context     (transform: streaming→streaming，不切换mode)
  → format-messages     (transform: streaming→formatted)
  → stream-llm          (transform: formatted→executing)
  → check-follow-up     (boundary:  executing→ready_to_finalize)
  → finalize            (sink:      ready_to_finalize→PipelineResult)
```

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
  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const now = new Date().toISOString();
    const cwd = process.cwd();
    const os = `${process.platform} ${process.arch}`;

    const contextData = [
      `Current Time: ${now}`,
      `Working Directory: ${cwd}`,
      `OS: ${os}`,
    ].join("\n");

    return { ...input, contextData };
  }
}
```

**未来扩展**:
- MemoryService 查询长期记忆，附加到 contextData
- SessionContext 中的 inference facts
- sandbox 目录结构快照

### 3.3 `format-messages`（修改）

**kind**: `transform`

**职责**: 收敛前两个 Element 的数据，组装完整 messages 数组

```typescript
class FormatMessagesElement extends BaseElement {
  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const messages: Message[] = [];

    // 第 1 层：安全提示词
    if (input.systemPrompt) {
      messages.push({ role: "system", content: input.systemPrompt });
    }

    // 第 2 层：上下文数据
    if (input.contextData) {
      messages.push({ role: "system", content: input.contextData });
    }

    // 第 3 层：会话历史
    for (const m of input.prompts ?? []) {
      messages.push({ role: m.role, content: m.content });
    }

    // 第 4 层：当前用户输入
    const text = input.task?.payload?.[0]?.data;
    if (text) {
      messages.push({ role: "user", content: text });
    }

    return { ...input, mode: "formatted", messages };
  }
}
```

**关键变化**: `mode` 从 `streaming` 切到 `formatted`，`stream-llm` 门控对应更新

---

## 4. FlowState 类型扩展

```typescript
type ConversationFlowState = {
  mode: "initial" | "streaming" | "formatted" | "executing" | "ready_to_finalize";
  task: TaskItem;
  // 新增
  systemPrompt?: string;      // load-system-prompt 写入
  contextData?: string;       // collect-context 写入
  messages?: Message[];       // format-messages 写入（组装后）
  prompts?: PromptItem[];     // collect-prompts 写入（会话历史）
  responseText?: string;      // stream-llm 写入
  followUp?: FollowUpData;    // check-follow-up 写入
};
```

---

## 5. `stream-llm` 门控调整

```typescript
// 原来
if (input.mode !== "streaming") return input;

// 改为
if (input.mode !== "formatted") return input;

// 直接使用组装好的 messages
const result = await generateText({
  model,
  messages: input.messages,  // 不再自行组装
  maxTokens: 1024,
});
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
