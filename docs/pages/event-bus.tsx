import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ── Core Implementation ── */}
      <Section title="核心实现">
        <CodeBlock lang="typescript" code={`// src/src/packages/shared/src/pipeline/event-bus.ts

export class PipelineEventBus<TEvents extends Record<string, any>> {
  #handlers = new Map<string, Set<(...args: any[]) => void>>();
  #errorHandler?: (eventName: string, error: unknown) => void;

  /** Register a handler. Returns an unsubscribe function. */
  on<E extends keyof TEvents & string>(
    eventName: E,
    handler: (payload: TEvents[E]) => void,
  ): () => void {
    if (!this.#handlers.has(eventName)) {
      this.#handlers.set(eventName, new Set());
    }
    this.#handlers.get(eventName)!.add(handler);
    return () => this.#handlers.get(eventName)?.delete(handler);
  }

  /** Emit an event. Handlers run synchronously. Errors are caught. */
  emit<E extends keyof TEvents & string>(
    eventName: E,
    payload: TEvents[E],
  ): void {
    const handlers = this.#handlers.get(eventName);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (error) {
        this.#errorHandler?.(eventName, error);
      }
    }
  }

  /** Set a global error handler for handler errors */
  onHandlerError(handler: (eventName: string, error: unknown) => void): void {
    this.#errorHandler = handler;
  }

  /** Remove all handlers for an event */
  clear(eventName: string): void {
    this.#handlers.delete(eventName);
  }
}`} />

        <ComparisonTable
          headers={["方法", "签名", "说明"]}
          rows={[
            [<Badge color="blue">on</Badge>, <code>{`on(eventName, handler) => () => void`}</code>, "注册处理器，返回取消订阅函数"],
            [<Badge color="green">emit</Badge>, <code>{`emit(eventName, payload) => void`}</code>, "同步触发所有处理器"],
            [<Badge color="orange">onHandlerError</Badge>, <code>{`onHandlerError(handler) => void`}</code>, "全局错误处理器"],
            [<Badge color="red">clear</Badge>, <code>{`clear(eventName) => void`}</code>, "移除事件的所有处理器"],
          ]}
        />

        <Callout type="tip" title="设计决策">
          <ul>
            <li>处理器 <strong>同步执行</strong> — 防止阻塞 pipeline</li>
            <li>一个处理器出错不影响其他处理器</li>
            <li><code>on()</code> 返回取消订阅函数</li>
            <li>单线程模型 — 无竞态条件</li>
          </ul>
        </Callout>
      </Section>

      {/* ── Event Flow Diagram ── */}
      <Section title="事件流转架构">
        <div className="arch-layers">
          <div className="arch-layer arch-layer-tui" style={{ borderLeftColor: "var(--color-danger, #ef4444)" }}>
            <div className="arch-layer__label" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Badge color="red">Emitter</Badge> Element / Service / External
            </div>
            <div className="arch-layer__desc" style={{ marginTop: "8px" }}>
              <code style={{ fontSize: "12px" }}>this.report("element.data", payload)</code> — Element 内部<br />
              <code style={{ fontSize: "12px" }}>bus.emit("task.completed", payload)</code> — Service 直接<br />
              <code style={{ fontSize: "12px" }}>WebSocket broadcast</code> — 客户端观察
            </div>
          </div>
          <div style={{ textAlign: "center", padding: "8px", color: "var(--color-muted, #6b7280)", fontSize: "20px" }}>↓</div>
          <div className="arch-layer arch-layer-core">
            <div className="arch-layer__label" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Badge color="blue">PipelineEventBus</Badge> 事件总线
            </div>
            <div className="arch-layer__desc" style={{ marginTop: "8px" }}>
              <code style={{ fontSize: "12px" }}>#handlers: Map&lt;string, Set&lt;Function&gt;&gt;</code><br />
              同步遍历所有处理器 · 错误隔离 · 单线程
            </div>
          </div>
          <div style={{ textAlign: "center", padding: "8px", color: "var(--color-muted, #6b7280)", fontSize: "20px" }}>↓</div>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            {[
              { label: "TaskEngine", desc: "task.* 事件" },
              { label: "WebSocket", desc: "广播到客户端" },
              { label: "Replay", desc: "事件录制重放" },
              { label: "Logging", desc: "结构化日志" },
            ].map((h) => (
              <div key={h.label} style={{ padding: "12px 16px", borderRadius: "8px", border: "1px solid var(--color-border, #334155)", background: "var(--color-surface, #1e1e2e)", minWidth: "120px", textAlign: "center" }}>
                <div style={{ fontWeight: 600, fontSize: "14px" }}>{h.label}</div>
                <div style={{ fontSize: "12px", color: "var(--color-muted, #6b7280)", marginTop: "4px" }}>{h.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Event Type Registration ── */}
      <Section title="事件类型注册">
        <Callout type="info" title="三层事件映射">
          事件类型按职责分为三层：<strong>Pipeline</strong>（Element 生命周期）、<strong>Core</strong>（任务调度）、<strong>Domain</strong>（业务领域）。最终通过 intersection 组合为 <code>FullEventMap</code>。
        </Callout>
        <CodeBlock lang="typescript" code={`// Base events (emitted by PipelineRunner and Elements):
export type PipelineEventMap = {
  "element.state-changed": {
    name: string;
    payload: { state: "READY" | "WORKING" | "DONE" | "FAILED" };
  };
  "pipeline.element.started": {
    pipelineName: string; elementName: string; elementKind: string;
  };
  "pipeline.element.finished": {
    pipelineName: string; elementName: string; elementKind: string; durationMs: number;
  };
  "pipeline.element.failed": {
    pipelineName: string; elementName: string; elementKind: string;
    durationMs: number; error: unknown;
  };
  "element.data": { name: string; payload: Record<string, unknown>; };
};

// Core-level events (emitted by TaskEngine, services):
export type CoreEventMap = {
  "task.enqueued": { task: TaskItem };
  "task.activated": { task: TaskItem };
  "task.completed": { task: TaskItem; result: PipelineResult };
  "task.failed": { task: TaskItem; error: unknown };
  "pipeline.result": { task: TaskItem; result: PipelineResult };
};

// Domain events (emitted by specific elements):
export type DomainEventMap = {
  "intent.parsed": { parsedCount: number; safeCount: number; rejectedCount: number; };
  "transport.delta": { textDelta: string };
  "transport.tool.started": { toolName: string; toolCallId: string; input: unknown };
  "transport.tool.finished": { toolName: string; toolCallId: string; result?: unknown; error?: unknown };
  "transport.failed": { error: unknown };
};

// Combined event map:
export type FullEventMap = PipelineEventMap & CoreEventMap & DomainEventMap;`} />
      </Section>

      {/* ── Register Custom Events ── */}
      <Section title="注册自定义事件（三步法）">
        <div className="cmp" style={{ display: "flex", gap: "16px", flexDirection: "column" }}>
          {[
            { step: "1", title: "定义事件类型", desc: "在模块 types.ts 中定义事件映射", color: "blue" },
            { step: "2", title: "扩展全局事件映射", desc: "将新类型 & 合并到 FullEventMap", color: "purple" },
            { step: "3", title: "使用总线", desc: "bus.emit() / bus.on()", color: "green" },
          ].map((s) => (
            <div key={s.step} style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "16px", borderRadius: "8px", border: "1px solid var(--color-border, #334155)", background: "var(--color-surface, #1e1e2e)" }}>
              <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: `var(--color-${s.color}, #6366f1)`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "14px", flexShrink: 0 }}>{s.step}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px" }}>{s.title}</div>
                <div style={{ fontSize: "13px", color: "var(--color-muted, #6b7280)", marginTop: "4px" }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <CodeBlock lang="typescript" code={`// 1. Define the event type in your module's types.ts:
export type SessionEventMap = {
  "session.created": { sessionId: string };
  "session.destroyed": { sessionId: string };
  "session.evicted": { sessionId: string; reason: string };
};

// 2. Extend the global event map:
export type FullEventMap = PipelineEventMap & CoreEventMap
  & DomainEventMap & SessionEventMap;

// 3. Use the bus in your code:
bus.emit("session.created", { sessionId });
bus.on("session.destroyed", ({ sessionId }) => {
  mcpManager.disconnectAll(sessionId);
});`} />
      </Section>

      {/* ── Usage Patterns ── */}
      <Section title="使用模式">
        <ComparisonTable
          headers={["场景", "模式", "代码"]}
          rows={[
            ["Element → Bus", "通过 report()", <code>{`this.report("element.data", { event, data })`}</code>],
            ["Service → Bus", "直接 emit", <code>{`this.#bus.emit("task.completed", { task, result })`}</code>],
            ["Client → Bus", "WebSocket 广播", <code>{`bus.on("task.activated", payload => broadcaster.send(...))`}</code>],
            ["Cleanup", "off 返回取消函数", <code>{`const off = bus.on(...); off();`}</code>],
          ]}
        />

        <CodeBlock lang="typescript" code={`// Element → Bus (via report())
class MyElement extends BaseElement {
  async doProcess(input: FlowState) {
    this.report("element.data", {
      event: "my-event",
      data: "something happened",
    });
  }
}

// Cleanup Pattern (off returns unsubscribe function)
const offDelta = bus.on("transport.delta", handleDelta);
const offToolStarted = bus.on("transport.tool.started", handleToolStarted);

// Later, when cleaning up:
offDelta();
offToolStarted();`} />
      </Section>

      {/* ── Thread Safety ── */}
      <Section title="线程安全与异步">
        <Callout type="warn" title="关键约束">
          PipelineEventBus 设计为 <strong>单线程同步</strong> 模型。处理器在 emit() 期间同步执行。如需异步，将工作委托给任务队列，不要直接在处理器中 await。
        </Callout>
        <CodeBlock lang="typescript" code={`// BAD (blocks the bus):
bus.on("task.completed", async (payload) => {
  await saveToDatabase(payload);  // Blocks all other handlers!
});

// GOOD (delegate to task queue):
bus.on("task.completed", (payload) => {
  taskQueue.enqueueBackgroundJob(() => saveToDatabase(payload));
});`} />
      </Section>

      {/* ── Testing ── */}
      <Section title="测试">
        <CodeBlock lang="typescript" code={`test("bus emits and handles events", () => {
  const bus = new PipelineEventBus<TestEventMap>();
  const handler = mock(() => {});

  const off = bus.on("test.event", handler);
  bus.emit("test.event", { data: "hello" });

  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith({ data: "hello" });

  off();
  bus.emit("test.event", { data: "world" });
  expect(handler).toHaveBeenCalledTimes(1);  // Still only called once
});

test("bus catches handler errors", () => {
  const bus = new PipelineEventBus<TestEventMap>();
  const errorHandler = mock(() => {});
  bus.onHandlerError(errorHandler);

  bus.on("test.event", () => { throw new Error("boom"); });
  bus.emit("test.event", {});

  expect(errorHandler).toHaveBeenCalledTimes(1);
});`} />
      </Section>
    </div>
  );
}
