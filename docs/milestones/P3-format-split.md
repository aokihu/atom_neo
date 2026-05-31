# P3: 拆分 format-messages + system 参数修复 — 实施方案 ✅ 已完成

## 目标

1. 拆分 `format-messages` 为 `format-system-messages` 和 `format-user-messages` 两个独立元素
2. `stream-llm` 使用 `generateText({ system, messages })` 消除 AI SDK 安全警告
3. 每个元素只关注一个功能

## 当前状态

```typescript
// format-messages (一个元素做两件事)
const messages = [];
if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
if (compiledAgents) messages.push({ role: "system", content: compiledAgents });
if (contextData) messages.push({ role: "system", content: contextData });
for (const m of prompts) messages.push({ role: m.role, content: m.content });
// → 混在 messages 数组中传递 → generateText({ messages }) → AI SDK warning
```

## 改造方案

### 1. Pipeline 链（8→9 Element）

```
load-system-prompt → fetch-agents-prompt → collect-context
→ format-system-messages  (streaming → streaming, 不切换mode)
→ format-user-messages    (streaming → formatted,   切换mode)
→ stream-llm              (formatted → executing,   system参数)
```

### 2. format-system-messages

```typescript
class FormatSystemMessagesElement extends BaseElement {
  async doProcess(input): Promise {
    if (input.mode !== "streaming") return input;
    const parts = [];
    if (input.systemPrompt) parts.push(input.systemPrompt);
    if (input.compiledAgentsPrompt) parts.push(input.compiledAgentsPrompt);
    if (input.contextData) parts.push(input.contextData);
    return { ...input, systemText: parts.join("\n\n") };
  }
}
```

### 3. format-user-messages

```typescript
class FormatUserMessagesElement extends BaseElement {
  async doProcess(input): Promise {
    if (input.mode !== "streaming") return input;
    const messages = [];
    for (const m of input.prompts ?? []) {
      messages.push({ role: m.role, content: m.content });
    }
    const text = input.task?.payload?.[0]?.data;
    if (text) messages.push({ role: "user", content: text });
    return { ...input, mode: "formatted", userMessages: messages };
  }
}
```

### 4. stream-llm 修改

```typescript
// 之前
generateText({ messages: input.messages })

// 之后
generateText({
  system: input.systemText,
  messages: input.userMessages,
})
```

### 5. FlowState 类型

```typescript
// 删除
messages?: Message[];

// 新增
systemText?: string;
userMessages?: Message[];
```

### 6. 改动范围

| 文件 | 操作 |
|------|------|
| `elements/index.ts` | 删 FormatMessagesElement，加 2 个新元素，更新 StreamLLMElement |
| `pipeline/conversation/index.ts` | 注册更新，链调整 |
| `pipeline/conversation/types.ts` | FlowState 类型更新 |
