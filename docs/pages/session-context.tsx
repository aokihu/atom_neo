import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ── SessionContext Class ── */}
      <Section title="SessionContext 类">
        <CodeBlock lang="typescript" code={`// src/packages/core/src/session/context.ts

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

  // MCP connections (per-session)
  #mcpConnections: MCPConnection[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  // ... getters and setters
}`} />
        <Callout type="tip" title="v1 → v2 变化">
          取代 v1 的全局 <code>ContextManager</code>（1299 行单体）。每个 session 独立实例，完全隔离，支持多用户并发。
        </Callout>
      </Section>

      {/* ── Session Lifecycle ── */}
      <Section title="Session 生命周期">
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "space-between", marginBottom: "16px" }}>
          {[
            { label: "创建", desc: "sessionStore.get(id) 按需创建", color: "blue" },
            { label: "准备", desc: "Orchestrator 注入初始上下文", color: "purple" },
            { label: "运行中", desc: "消息累积、Memory Scope 查询", color: "green" },
            { label: "完成", desc: "最终化状态、保存 Memory", color: "orange" },
            { label: "销毁", desc: "sessionStore.delete(id) 释放", color: "red" },
          ].map((phase, idx, arr) => (
            <React.Fragment key={phase.label}>
              <div style={{ flex: "1 1 160px", padding: "12px", borderRadius: "8px", border: "1px solid var(--color-border, #334155)", borderTop: `3px solid var(--color-${phase.color}, #6366f1)`, background: "var(--color-surface, #1e1e2e)", textAlign: "center" }}>
                <div style={{ fontWeight: 600, fontSize: "13px" }}>{phase.label}</div>
                <div style={{ fontSize: "11px", color: "var(--color-muted, #6b7280)", marginTop: "6px" }}>{phase.desc}</div>
              </div>
              {idx < arr.length - 1 && (
                <div style={{ display: "flex", alignItems: "center", color: "var(--color-muted, #6b7280)", fontSize: "18px", flexShrink: 0 }}>→</div>
              )}
            </React.Fragment>
          ))}
        </div>
      </Section>

      {/* ── Key Types ── */}
      <Section title="关键类型定义">
        <CodeBlock lang="typescript" code={`type ChatMessage = {
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
};`} />
      </Section>

      {/* ── Session Store ── */}
      <Section title="Session Store">
        <ComparisonTable
          headers={["方法", "签名", "说明"]}
          rows={[
            [<Badge color="blue">get</Badge>, <code>{`(sessionId: string) => SessionContext`}</code>, "按需创建或返回已有 session；超限时驱逐最旧"],
            [<Badge color="red">delete</Badge>, <code>{`(sessionId: string) => void`}</code>, "从 store 中移除 session"],
            [<Badge color="purple">save</Badge>, <code>{`(sessionId: string) => Promise<void>`}</code>, "可选：持久化到存储"],
            [<Badge color="purple">load</Badge>, <code>{`(sessionId: string) => Promise<SessionContext | null>`}</code>, "可选：从存储加载"],
            [<Badge color="orange">onEvict</Badge>, <code>{`(sessionId: string) => void`}</code>, "驱逐回调（用于清理 MCP 连接等）"],
          ]}
        />
        <CodeBlock lang="typescript" code={`// src/packages/core/src/session/store.ts

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

  onEvict?: (sessionId: string) => void;
}`} />
      </Section>

      {/* ── Orchestrator Integration ── */}
      <Section title="Orchestrator 集成">
        <CodeBlock lang="typescript" code={`// src/packages/core/src/runtime/orchestrator.ts

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
}`} />
      </Section>

      {/* ── MCP Connection Management ── */}
      <Section title="MCP 连接管理（Per-Session）">
        <CodeBlock lang="typescript" code={`// src/packages/core/src/session/mcp-connections.ts

export interface MCPConnection {
  serverName: string;
  transport: "stdio" | "sse";
  status: "connecting" | "connected" | "disconnected";
  tools: ToolDefinition[];
  resources: ToolDefinition[];

  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

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
}`} />
        <Callout type="info" title="Per-Session 隔离优势">
          每个 session 独立管理自己的 MCP 连接。Session 销毁时 <code>disconnectAll()</code> 自动清理，无资源泄漏。
        </Callout>
      </Section>

      {/* ── Memory Scope Lifecycle ── */}
      <Section title="Memory Scope 生命周期">
        <div className="cmp" style={{ display: "flex", gap: "12px", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: "0", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
            {["idle", "searching", "loaded"].map((status, idx, arr) => (
              <React.Fragment key={status}>
                <div style={{ padding: "10px 16px", borderRadius: "8px", border: "1px solid var(--color-border, #334155)", background: "var(--color-surface, #1e1e2e)", textAlign: "center", minWidth: "100px" }}>
                  <div style={{ fontWeight: 600, fontSize: "13px" }}>{status}</div>
                  <div style={{ fontSize: "11px", color: "var(--color-muted, #6b7280)", marginTop: "4px" }}>
                    {status === "idle" ? "初始 / 已重置" : status === "searching" ? "查询执行中" : "数据已加载"}
                  </div>
                </div>
                {idx < arr.length - 1 && <div style={{ margin: "0 8px", color: "var(--color-accent, #6366f1)", fontSize: "18px" }}>→</div>}
              </React.Fragment>
            ))}
          </div>
          <div style={{ textAlign: "center", fontSize: "12px", color: "var(--color-muted, #6b7280)" }}>
            idle → searching → loaded (数据可供 LLM 使用)<br />
            idle → searching → empty (无结果) · 对话结束 → reset → idle
          </div>
        </div>
        <CodeBlock lang="typescript" code={`ctx.setMemoryScopeStatus("long", "searching",
  "user query about project structure");
// ... after search completes ...
ctx.setMemoryScopeStatus("long", "loaded",
  "user query about project structure");

// When session ends:
ctx.resetMemoryScopes();  // All go back to idle`} />
      </Section>
    </div>
  );
}
