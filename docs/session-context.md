# Session Context Specification

> **Purpose**: Define the per-session context model as a replacement for v1's global ContextManager.
> Each session gets its own isolated `SessionContext` instance.

---

## 1. SessionContext

```typescript
// src/packages/core/src/session/context.ts

export class SessionContext {
  readonly sessionId: string;

  // Conversation messages (user + assistant)
  #messages: ChatMessage[] = [];

  // Hidden facts for inference
  #inferenceFacts: InferenceFact[] = [];

  // Tool execution context
  #toolContext: ToolContext = { mode: "idle", results: [] };

  // Memory scopes (core / short / long)
  #memoryScopes: MemoryScopeState = {
    core: { status: "idle", query: "" },
    short: { status: "idle", query: "" },
    long: { status: "idle", query: "" },
  };

  // Continuation context (for follow-up)
  #continuationContext: ContinuationContext | null = null;

  // Token usage
  #tokenUsage: TokenUsage = { total: 0 };

  get tokenUsage(): Readonly<TokenUsage> { return this.#tokenUsage; }
  addTokenUsage(total: number): void {
    this.#tokenUsage.total += total;
  }

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  // ... getters and setters
}
```

## 2. Session Store

```typescript
// src/packages/core/src/session/store.ts

export class SessionStore {
  #sessions = new Map<string, SessionContext>();
  #maxSessions: number;

  constructor(maxSessions = 1000) {
    this.#maxSessions = maxSessions;
  }

  get(sessionId: string): SessionContext {
    let session = this.#sessions.get(sessionId);
    if (!session) {
      session = new SessionContext(sessionId);
      this.#sessions.set(sessionId, session);

      // Evict oldest if over limit
      if (this.#sessions.size > this.#maxSessions) {
        const oldest = this.#sessions.keys().next().value;
        this.#sessions.delete(oldest);
        this.onEvict?.(oldest);
      }
    }
    return session;
  }

  delete(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  // Optional: persist to storage
  async save(sessionId: string): Promise<void> { /* ... */ }
  async load(sessionId: string): Promise<SessionContext | null> { /* ... */ }

  // For cleanup
  onEvict?: (sessionId: string) => void;
}
```

## 3. Key Types

```typescript
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

type InferenceFact = {
  key: string;
  value: string;
  reason: string;
};

type ToolContext = {
  mode: "idle" | "active" | "finished";
  results: ToolResult[];
};

type MemoryScopeState = {
  core: { status: "idle" | "loaded" | "searching"; query: string };
  short: { status: "idle" | "loaded" | "searching"; query: string };
  long: { status: "idle" | "loaded" | "searching"; query: string };
};

type ContinuationContext = {
  summary: string;
  nextPrompt: string;
  avoidRepeat: string;
  updatedAt: number;
};

type TokenUsage = {
  total: number;
};

// Ratio: total / TOKEN_BUDGET(default 1,000,000)
const TOKEN_BUDGET = 1_000_000;
```

## 4. Orchestrator Integration

```typescript
// src/packages/core/src/runtime/orchestrator.ts

export class ConversationOrchestrator {
  #sessionStore: SessionStore;

  constructor(sessionStore: SessionStore) {
    this.#sessionStore = sessionStore;
  }

  // Called before pipeline starts
  prepareSession(sessionId: string): SessionContext {
    return this.#sessionStore.get(sessionId);
  }

  // Called after pipeline finishes
  finalizeSession(sessionId: string, result: PipelineResult): void {
    const ctx = this.#sessionStore.get(sessionId);
    // Save final state, update memory scopes, etc.
  }
}
```

## 5. MCP Connection Management (Per-Session)

```typescript
// src/packages/core/src/session/mcp-connections.ts

export interface MCPConnection {
  serverName: string;
  transport: "stdio" | "sse";
  status: "connecting" | "connected" | "disconnected";
  tools: ToolDefinition[];
  resources: ToolDefinition[];

  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

// Each session manages its own MCP connections:
export class SessionMCPManager {
  #connections = new Map<string, MCPConnection>();

  async connect(serverName: string, config: MCPConfig): Promise<void> {
    const conn = createMCPConnection(config);
    await conn.connect();
    this.#connections.set(serverName, conn);
  }

  disconnectAll(): Promise<void> {
    return Promise.all(
      [...this.#connections.values()].map(c => c.disconnect())
    );
  }

  getTools(): ToolDefinition[] {
    return [...this.#connections.values()].flatMap(c => c.tools);
  }
}
```

## 6. Memory Scope Lifecycle

```typescript
// Memory scopes in SessionContext follow this lifecycle:

// idle → searching → loaded (data available for LLM)
// idle → searching → empty (no results)

ctx.setMemoryScopeStatus("long", "searching", "user query about project structure");
// ... after search completes ...
ctx.setMemoryScopeStatus("long", "loaded", "user query about project structure");

// When session ends:
ctx.resetMemoryScopes();  // All go back to idle

## 7. Token Usage Tracking

```
AI SDK streamResult.usage
  → { inputTokens, outputTokens, totalTokens }
      ↓
StreamLLMElement → ConversationFlowState.tokenUsage
      ↓
FinalizeElement → PipelineResult.tokenUsage
      ↓
server.ts task.completed handler
  → sessionContext.addTokenUsage(tokenUsage)
  → session tokenUsage 累积到会话级统计
```

**双重用途：**
1. **LLM 上下文** — `CollectContextElement` 从 session 读取 `tokenUsage.total`，注入 system context：
   ```
   Session Token Usage:
     Total: 12,480 / 1,000,000 (1.25%)
   ```
2. **TUI 展示** — 右侧栏实时显示 tokens 和 ratio：
   ```
   Usage:
     tokens     12,480
     ratio       1.25%
   ```
```
