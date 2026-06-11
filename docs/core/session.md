# Session & State Management

> **Purpose**: Per-session context model, topic tracking, and TUI lifecycle — how sessions are isolated, managed, and reflected in the UI.

---

# Part 1: SessionContext

## 1. Data Model

```typescript
export class SessionContext {
  readonly sessionId: string;
  #messages: ChatMessage[] = [];
  #inferenceFacts: InferenceFact[] = [];
  #toolContext: ToolContext = { mode: "idle", results: [] };
  #memoryScopes: MemoryScopeState = {
    core: { status: "idle", query: "" },
    short: { status: "idle", query: "" },
    long: { status: "idle", query: "" },
  };
  #continuationContext: ContinuationContext | null = null;
  #currentTopic: string | null = null;
  #tokenUsage: TokenUsage = { total: 0 };
  #chainDepth: number = 0;
  #todoState: TodoItem[] = [];
  // Compress state
  #compressing: boolean = false;       // 单锁，防重复压缩
  #compressRetry: number = 0;          // 压缩重试计数
  #compressRatio: number = 0;          // 动态压缩比
  #lastSafeMsgCount: number = 0;       // 安全边界：上次成功前的消息数
  // Pipeline-consumed transient fields (set by pipeline elements, consumed by collect-context)
  pendingPrediction?: any;              // IntentPredictionResult (prediction pipeline)
  evaluatorSuggestion?: string;         // 健康评估建议 (follow-up-evaluator pipeline)
  upgradeModel?: boolean;               // 是否升级模型 (follow-up-evaluator pipeline)
  conversationSummary?: string;         // 压缩摘要 (context-compress pipeline)
  postCheckGuidance?: string;           // 重试引导文本 (post-conversation pipeline)
}
```

### Transient 字段说明

这些字段由不同 pipeline 在运行中设置和消费，不在 `toJSON()` 中序列化，`resetForNewTopic()` 时会清空：

| 字段 | 写入者 | 消费者 | 说明 |
|------|--------|--------|------|
| `pendingPrediction` | prediction pipeline (predict-finalize) | collect-context (读取 difficulty 注入难度规则) | 存储意图预分类结果 |
| `evaluatorSuggestion` | follow-up-evaluator pipeline (evaluate-finalize) | collect-context (通过 CONTEXT_EVALUATOR_HINT 注入) | 当 health=looping/degrading 时的建议文本 |
| `upgradeModel` | follow-up-evaluator pipeline (evaluate-finalize) | collect-context (通过 CONTEXT_MODEL_UPGRADE 注入) | 触发下一轮对话使用更高阶模型 |
| `conversationSummary` | context-compress pipeline (compress-finalize) | collect-context (作为原始文本追加) | LLM 生成的对话历史摘要 |
| `postCheckGuidance` | post-conversation pipeline (post-finalize) | collect-context (作为原始文本追加) | 当 status=blocked 时的重试引导文本 |
```

## 2. Session Store

```typescript
export class SessionStore {
  #sessions = new Map<string, SessionContext>();
  #maxSessions: number;

  get(sessionId: string): SessionContext {
    let session = this.#sessions.get(sessionId);
    if (!session) {
      session = new SessionContext(sessionId);
      this.#sessions.set(sessionId, session);
      if (this.#sessions.size > this.#maxSessions) {
        const oldest = this.#sessions.keys().next().value;
        this.#sessions.delete(oldest);
      }
    }
    return session;
  }
}
```

## 3. Key Types

```typescript
type ChatMessage = { role: "user" | "assistant"; content: string; timestamp: number };
type InferenceFact = { key: string; value: string; reason: string };
type ToolContext = { mode: "idle" | "active" | "finished"; results: ToolResult[] };
type ContinuationContext = { summary: string; nextPrompt: string; avoidRepeat: string; updatedAt: number };
type TokenUsage = { total: number };
const TOKEN_BUDGET = 1_000_000;
```

## 4. Orchestrator Integration

```typescript
export class ConversationOrchestrator {
  #sessionStore: SessionStore;

  prepareSession(sessionId: string): SessionContext {
    return this.#sessionStore.get(sessionId);
  }

  finalizeSession(sessionId: string, result: PipelineResult): void {
    const ctx = this.#sessionStore.get(sessionId);
    // Save final state, update memory scopes
  }
}
```

## 5. Token Usage Tracking

```
AI SDK streamResult.usage
  → {inputTokens, outputTokens, totalTokens}
    ↓
StreamLLMElement → sessionContext.addTokenUsage(totalTokens)

双重用途:
1. LLM context: collect-context 注入 tokenUsage.total → system prompt
2. TUI display: 侧栏显示 tokens / TOKEN_BUDGET ratio
```

---

# Part 2: Topic System

## 1. 设计原则

- **系统驱动切换** — topic 由 prediction pipeline 自动检测，LLM 不参与切换决策
- **保留历史** — 切换时保留 messages/inferenceFacts/memoryScopes/tokenUsage
- **重置任务状态** — todoState/chainDepth/toolContext/continuationContext 清空

## 2. Topic 格式

```
<category>.<domain>.<specific>
categories: creative | tools | code | knowledge | chat
```

| 示例 | 含义 |
|------|------|
| `creative.history.ancient` | 创作：古代历史文章 |
| `tools.filesystem.explore` | 工具：浏览文件系统 |
| `code.warehouse.management` | 编码：仓库管理系统 |

## 3. 触发流程

```
用户输入 → predict-intent → 5字段分类（含 topic）
  → predict-finalize:
    ├─ newTopic !== session.currentTopic → resetForNewTopic(newTopic)
    └─ newTopic === session.currentTopic → 保持上下文
  → collect-context: 注入 [主题约束] 到 context
  → stream-llm: activeTools 由 intent 独立控制
```

## 4. resetForNewTopic()

```typescript
resetForNewTopic(topic: string): void {
  this.#currentTopic = topic || null;
  this.#todoState = [];
  this.#chainDepth = 0;
  this.#toolContext = { mode: "idle", results: [] };
  this.#continuationContext = null;
  // 保留: #messages, #inferenceFacts, #memoryScopes, #tokenUsage, sessionId
}
```

## 5. 双重边界

| 边界层 | 实现 | 效果 |
|--------|------|------|
| 主题约束 | context 注入 + activeTools | LLM 被约束在主题范围内 |
| 工具过滤 | intent → getActiveToolNames() | instruction→17工具, question→12工具, creative→11工具, conversation→8工具 |

---

# Part 3: Session Lifecycle (TUI)

## 1. 问题

Spinner 生命周期绑定在"第一个 text delta"时刻，但真正的会话结束是 TaskCompleted（根任务 resolve）。两者之间有时间差，链式任务期间 TUI 无指示器。

| 场景 | 现象 | 后果 |
|------|------|------|
| 链式任务间隙 | 文本输出完了，内部在做 follow_up | 用户屏幕空白 |
| 纯工具响应 | 无文本输出，spinner 永不消失 | 用户困惑 |
| 流式结束后 | 文本完成但 TaskCompleted 未到 | 用户提前输入 |

## 2. 方案：sessionBusy

```
send() 调用 → sessionBusy = true
  ├── thinking msg (spinner) — 无文本输出时
  ├── 文本开始 → thinking 移除, StatusLine ⏳ processing
  ├── 工具执行 → StatusLine ⏳ processing
  └── 链式任务间隙 → thinking msg — 无文本输出时
send() resolve/reject → sessionBusy = false → 一切清空
```

## 3. TUI 规则

| 条件 | Spinner | StatusLine |
|------|---------|-----------|
| `sessionBusy && 无文本 && 无运行中工具` | 显示 | `⏳ processing...` |
| `sessionBusy && (有文本 \|\| 工具运行中)` | 隐藏 | `⏳ processing...` |
| `!sessionBusy` | 隐藏 | 隐藏 |

## 4. 关键设计

- **sessionBusy 覆盖链式任务** — `send()` 的 await 等到根 TaskCompleted 才 resolve
- **工具执行期间 StatusLine 持续** — 配合 `tool.state === "running"` 检查
- **第一个 text delta 后 spinner 不再需要** — 文本正在输出，用户可见

## 5. 涉及文件

```
src/packages/tui/src/hooks/useChat.ts    sessionBusy state
src/packages/tui/src/components/App.tsx  isProcessing → sessionBusy 驱动
src/packages/core/src/session/context.ts SessionContext 数据模型
```

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [task-execution.md](./task-execution.md) | TaskEngine 如何驱动 session 状态 |
| [pipeline-dev.md](./pipeline-dev.md) | Pipeline 中如何使用 SessionContext |
| [../pipelines/conversation.md](../pipelines/conversation.md) | Conversation Pipeline — stream-llm 如何触发 sessionBusy |
