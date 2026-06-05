# Conversation Pipeline

## 职责

核心对话管道。加载系统提示词和 Agent 指令、收集消息上下文、调用 LLM 流式生成、解析意图请求、处理链式续写。所有工具在 pipeline 启动时一次性加载。

## 触发方式

```
prediction pipeline → predict-finalize → orchestrator.scheduleConversation()
  → taskQueue.enqueue(task) → TaskEngine → pipelineBuilders["conversation"]
  → conversationPipeline(deps).build(bus)
```

## Element 链（9 个元素）

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
| 2 | `load-system-prompt` | transform | 加载 `base_system_prompt.md` |
| 3 | `fetch-agents-prompt` | transform | 获取 Agent 编译器输出的指令 |
| 4 | `collect-context` | transform | 构建环境上下文（cwd、OS、记忆、token 使用） |
| 5 | `format-system-messages` | transform | 合并 system prompt + agent prompt + context |
| 6 | `format-user-messages` | transform | 组装 user message 数组，切换 mode → `formatted` |
| 7 | `stream-llm` | transform | **核心：调用 LLM 流式生成** |
| 8 | `check-follow-up` | boundary | 根据意图和 finishReason 决定 chainAction |
| 9 | `finalize` | sink | 发出 `Conversation.Chain` 事件 → server.ts 统一调度 |

## FlowState

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
};
```

## 状态转移

```
initial
  → collect-prompts:      过滤可见消息                    → streaming
  → load-system-prompt:   加载 base_system_prompt.md       → streaming
  → fetch-agents-prompt:  获取编译后的 agent 指令           → streaming
  → collect-context:      构建环境上下文                    → streaming
  → format-system-messages: 合并 system + agent + context   → streaming
  → format-user-messages: 组装 user messages, mode 切换     → formatted
  → stream-llm:           调用 LLM, 处理 intent 工具调用     → executing
  → check-follow-up:      决定 chainAction                  → ready_to_finalize
  → finalize:             发出 Chain 或 Idle 事件           → PipelineResult
```

## stream-llm 详解

### 流式处理

```
LLM 输出 → text-delta chunks → fullStream 循环
  ├── text-delta:    实时 Transport.Delta → WebSocket 广播
  ├── tool-call:     检测 intent 信号 → 捕获意图数据
  ├── tool-result:   记录工具执行结果
  ├── finish:        记录 finishReason
  ├── <<<COMPLETE>>>: 过滤标记, 发 Transport.Complete 结构信号
  └── 最终:
       ├── response: 提取 reasoningContent
       ├── usage: 提取 tokenUsage
       └── chainAction: finishReason === "length" ? "follow_up" : undefined
```

### AI SDK 配置

| 参数 | 来源 | 默认 |
|------|------|------|
| `model` | `runtime.getResolvedModel(difficulty).model` | `"deepseek-v4-flash"` |
| `maxSteps` | `config.json → conversation.maxSteps` | `50` |
| `maxTokens` | `config.json → transport.maxOutputTokens` | `4096` |
| `tools` | 全部工具（启动时一次性加载） | `createAllTools()` |
| `providerOptions` | `{ deepseek: { thinking: { type: ... } } }` | thinking=disabled |

### Intent 工具

LLM 通过调用 `intent` 工具发出控制信号：

| action | 用途 |
|--------|------|
| `follow_up` | 请求分段续写（需 `next_prompt` + `summary` 或 `history_abstract`） |
| `keep_memory` | 保存记忆（需 `mem_id`） |

stream-llm 通过 `intentSignal` 闭包捕获 intent 工具调用参数。

## chainAction → 链式续写

finalize element 发出 `BusEvents.Conversation.Chain` 事件，server.ts 统一处理：

```
Conversation.Chain handler:
  ├── post_check_retry → incrementChainDepth + scheduleConversation
  ├── follow_up + depth >= maxChainDepth → scheduleEvaluator
  ├── follow_up + depth >= 3 && depth % 3 === 0 → scheduleEvaluator
  └── follow_up → incrementChainDepth + scheduleFollowUp
```

## Deps

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

## 文件

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
