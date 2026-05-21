import React from "react";
import type { DocPageProps } from "./shared";
import { Section, CodeBlock, Callout, ComparisonTable, Badge, PageHeader, parseInline } from "./shared";

export default function ArchitecturePage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={8} />

      {/* ── Section 1: v1 → v2 Core Changes ── */}
      <Section title="v1 → v2 核心变化">
        <ComparisonTable
          headers={["维度", "v1", "v2", "为什么"]}
          rows={[
            [<strong>任务调度</strong>, <><code>Core.runloop()</code> + sleep(500)</>, <><Badge color="green">NEW</Badge> <strong>事件驱动</strong> — task 入队触发 pipeline</>, "零空转延迟"],
            [<strong>上下文管理</strong>, <>全局 <code>ContextManager</code> <span className="muted">(1299 行)</span></>, <><Badge color="green">NEW</Badge> <strong>Per-Session</strong> 隔离</>, "多 session 并发安全"],
            [<strong>Memory 操作</strong>, <>独立 <code>memory-search</code> pipeline</>, <><Badge color="green">NEW</Badge> <strong>Tool Plugin</strong> — search_memory</>, "统一工具路径"],
            [<strong>LLM 输出</strong>, <><code>&lt;&lt;&lt;REQUEST&gt;&gt;&gt;</code> 标签 + regex</>, <><Badge color="green">NEW</Badge> <strong>Structured Output</strong> — AI SDK Output.object()</>, "零解析错误"],
            [<strong>Pipeline 组装</strong>, <>硬编码 <code>new Element()</code></>, <><Badge color="green">NEW</Badge> <strong>PipelineBuilder</strong> DSL</>, "热重载、运行时注册"],
            [<strong>通信</strong>, <>进程内 <code>EventEmitter</code></>, <><Badge color="green">NEW</Badge> <strong>WebSocket</strong> 事件流</>, "可观测、可录制"],
            [<strong>调试</strong>, <>日志文件 + debug listeners</>, <><Badge color="green">NEW</Badge> <strong>Pipeline Replay</strong></>, "问题复现成本为零"],
            [<strong>Pipeline 数量</strong>, "5 条", <><Badge color="green">3 条</Badge> — memory & tool 转为 plugin</>, "更少 pipeline，更少代码"],
          ]}
        />
        <Callout type="tip" title="关键创新">
          事件驱动替代轮询，Pipeline Builder DSL 替代硬编码，Per-Session 上下文实现多用户隔离。
        </Callout>
      </Section>

      {/* ── Section 2: System Architecture ── */}
      <Section title="系统架构：三层模型">
        <div className="arch-layers">
          <div className="arch-layer arch-layer-tui">
            <div className="arch-layer__label">TUI (Root)</div>
            <div className="arch-layer__desc">本地终端，直连 Core · WebSocket · root 权限</div>
          </div>
          <div className="arch-layer arch-layer-gateway">
            <div className="arch-layer__label">Gateway</div>
            <div className="arch-layer__desc">JWT 认证 → 权限检查 → 速率限制 → 请求转发</div>
          </div>
          <div className="arch-layer arch-layer-core">
            <div className="arch-layer__label">Core</div>
            <div className="arch-layer__desc">
              HTTP Server → Pipeline Bus → Tool Registry
            </div>
            <div className="arch-layer__sub">
              <span className="badge badge-blue">Task Engine (事件驱动)</span>
              <span className="badge badge-green">Event Stream (WebSocket)</span>
              <span className="badge badge-purple">Memory Plugin</span>
            </div>
          </div>
        </div>
        <Callout type="info" title="区别于 v1">
          Core 不轮询队列 → 事件驱动激活；每个 session 独立 Context 实例；Memory 是 Tool Plugin；所有通信走 WebSocket 事件流。
        </Callout>
      </Section>

      {/* ── Section 3: Event-Driven Scheduler ── */}
      <Section title="事件驱动调度（替代 runloop）">
        <Callout type="warn" title="v1 问题">
          轮询方式 <code>{"while(true) { if (queue.isEmpty) await sleep(500); }"}</code> 存在空闲延迟。
        </Callout>

        <CodeBlock lang="typescript" code={`// v1: 轮询
while (true) {
  if (queue.isEmpty) { await sleep(500); continue; }
  await runActivatedTask();
}

// v2: 事件驱动
class TaskEngine {
  constructor(bus: PipelineEventBus) {
    bus.on("task.enqueued", (task) => this.onTaskEnqueued(task));
    bus.on("pipeline.finished", (result) => this.onPipelineFinished(result));
    bus.on("pipeline.failed", (error) => this.onPipelineFailed(error));
  }

  private onTaskEnqueued(task: TaskItem) {
    if (!this.running) {
      this.runNext();
    }
  }
}`} />

        <Callout type="ok" title="优势">
          无空转等待，任务到达即处理，天然支持并发 pipeline。
        </Callout>
      </Section>

      {/* ── Section 4: Per-Session Context ── */}
      <Section title="Per-Session 上下文隔离">
        <CodeBlock lang="typescript" code={`// v1: 全局 ContextManager
class ContextManager {
  private state: RuntimeContext; // monolith
}

// v2: Per-Session
class SessionContext {
  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.messages = [];
    this.inferenceContext = { hiddenFacts: [] };
    this.toolContext = { mode: "idle" };
    this.memoryScopes = { core: "idle", short: "idle", long: "idle" };
  }
}

const session = sessionStore.get(sessionId);
const ctx = session.context;
ctx.addMessage(message);
ctx.setInferenceFacts(facts);`} />
        <Callout type="ok" title="优势">
          多用户并发安全，session 之间完全隔离，销毁简单（sessionStore.delete(id)）。
        </Callout>
      </Section>

      {/* ── Section 5: Pipeline Builder ── */}
      <Section title="声明式 Pipeline Builder">
        <div className="cmp">
          <div>
            <h4>v1 — 硬编码</h4>
            <CodeBlock lang="typescript" code={`return {
  elements: [
    new ExportPrompts({ ctx, runtime }),
    new TransformToPayload({ ctx, runtime, transportConfig }),
    new TransportForStream(ctx, serviceManager),
    // ... 7 more
  ],
};`} />
          </div>
          <div>
            <h4>v2 — 声明式 Builder <Badge color="green">NEW</Badge></h4>
            <CodeBlock lang="typescript" code={`pipeline("conversation")
  .source("export-prompts", { runtime })
  .transform("transform-prompts", { runtime, config })
  .transform("transport-stream", { serviceManager })
  .transform("transform-output", { runtime })
  .boundary("parse-intents", { runtime })
  .transform("execute-intents", { runtime, tools })
  .boundary("apply-execution")
  .sink("finalize", { runtime })
  .build();`} />
          </div>
        </div>
        <Callout type="tip" title="Element 注册表">
          通过 <code>elementRegistry.set(name, constructor)</code> 注册，Builder 按名称查找 Element，支持运行时热加载。
        </Callout>
      </Section>

      {/* ── Section 6: Structured Output ── */}
      <Section title="Structured Output（替代标签解析）">
        <ComparisonTable
          headers={["方式", "v1", "v2"]}
          rows={[
            ["解析方式", <code>text.match(/&lt;&lt;&lt;REQUEST&gt;&gt;&gt;([\s\S]*?)$/)</code>, <code>Output.object(schema)</code>],
            ["可靠性", <>"依赖正则，易出错"</>, <>"Schema 层面保证格式"</>],
          ]}
        />
        <CodeBlock lang="typescript" code={`// v2: 结构化输出
const result = await generateText({
  model,
  prompt,
  output: Output.object({
    schema: z.object({
      visibleText: z.string(),
      intent: z.object({
        requests: z.array(IntentRequestSchema),
        conversationState: z.enum(["active", "complete", "follow_up"]),
      }),
    }),
  }),
});`} />
      </Section>

      {/* ── Section 7: Tool Plugin ── */}
      <Section title="Tool Plugin 系统">
        <ComparisonTable
          headers={["Tool", "类别", "权限级别"]}
          rows={[
            [<code>read / write</code>, "Filesystem", "READ_ONLY / FILE_WRITE"],
            [<code>ls / grep / tree</code>, "Filesystem", "READ_ONLY"],
            [<code>cp / mv</code>, "Filesystem", "FILE_WRITE"],
            [<code>bash</code>, "Shell", "FULL (需确认)"],
            [<code>search_memory</code>, "Memory", "READ_ONLY"],
            [<code>save_memory</code>, "Memory", "FILE_WRITE"],
            [<code>traverse_memory</code>, "Memory", "READ_ONLY"],
            [<code>link_memory</code>, "Memory", "FILE_WRITE"],
            [<code>recall_memory</code>, "Memory", "READ_ONLY"],
          ]}
        />
      </Section>

      {/* ── Section 8: v1 → v2 Migration ── */}
      <Section title="v1 → v2 迁移对照">
        <ComparisonTable
          headers={["v1", "v2", "变化"]}
          rows={[
            [<code>Core.runloop()</code>, <><code>TaskEngine</code> + 事件驱动</>, "无空转延迟"],
            [<><code>ContextManager</code> <span className="muted">(1299 行)</span></>, <code>SessionContext</code>, "隔离、并发安全"],
            [<><code>Runtime</code> <span className="muted">(1210 行)</span></>, "4 个拆分模块", "单职责"],
            [<><code>memory-search</code> pipeline</>, <><code>memory.ts</code> Tool</>, "去 pipeline 化"],
            [<><code>tool-execution</code> pipeline</>, "inline 工具调用", "不跳转管线"],
            [<code>Output.object()</code>, <code>Output.object()</code>, "零解析错误"],
            [<>硬编码 <code>new Element()</code></>, <><code>PipelineBuilder</code> DSL</>, "可热加载"],
            [<code>EventEmitter</code>, "WebSocket 事件协议", "可录制重放"],
            [<>单包</>, "Monorepo (4 packages)", "模块隔离"],
          ]}
        />
      </Section>

      {/* ── Section 9: Pipeline 简化 ── */}
      <Section title="Pipeline 简化">
        <ComparisonTable
          headers={["v1 Pipeline", "v2 对应", "说明"]}
          rows={[
            [<code>formal-conversation</code>, <code>conversation</code>, "保留，Element 链用 Builder 组装"],
            [<code>user-intent-prediction</code>, <code>prediction</code>, "保留，改用 structured output"],
            [<code>post-follow-up</code>, <code>follow-up</code>, "保留"],
            [<code>memory-search</code>, <Badge color="green">Tool Plugin</Badge>, "改为 Tool: search_memory"],
            [<code>tool-execution</code>, <Badge color="green">Inline</Badge>, "工具调用在 pipeline 内完成"],
          ]}
        />
        <Callout type="info">
          <strong>v1: 5 条 pipeline → v2: 3 条 pipeline</strong> — memory 和 tool 执行转为 Plugin 模式，不再占用独立管线。
        </Callout>
      </Section>

      {/* ── Section 10: WebSocket Protocol ── */}
      <Section title="WebSocket 事件协议">
        <CodeBlock lang="typescript" code={`// Client → Core
type ClientEvent =
  | { type: "event.task.submit"; payload: TaskSubmitPayload }
  | { type: "event.task.cancel"; payload: { taskId: string } };

// Core → Client (广播)
type ServerEvent =
  | { type: "event.pipeline.element.started"; payload: ElementStartedPayload }
  | { type: "event.pipeline.element.finished"; payload: ElementFinishedPayload }
  | { type: "event.transport.delta"; payload: TransportDeltaPayload }
  | { type: "event.transport.tool.started"; payload: ToolStartedPayload }
  | { type: "event.transport.tool.finished"; payload: ToolFinishedPayload }
  | { type: "event.task.completed"; payload: TaskCompletedPayload }
  | { type: "event.task.failed"; payload: TaskFailedPayload }
  | { type: "event.task.state-changed"; payload: TaskStatePayload }
  | { type: "event.pipeline.replay-start"; payload: ReplayStartPayload }
  | { type: "event.pipeline.replay-end"; payload: ReplayEndPayload };`} />
      </Section>

      {/* ── Section 11: Implementation Plan ── */}
      <Section title="实现计划">
        <ComparisonTable
          headers={["阶段", "内容", "预估"]}
          rows={[
            [<><Badge color="blue">P1</Badge> 基础设施</>, "shared/ 类型 + Pipeline 核心 + 日志系统", "1 周"],
            [<><Badge color="blue">P2</Badge> Core 引擎</>, "事件驱动调度器 + Per-Session 上下文 + Tool Registry", "1.5 周"],
            [<><Badge color="blue">P3</Badge> Tool 插件</>, "文件系统 tools + Memory tools + Bash tool", "1 周"],
            [<><Badge color="blue">P4</Badge> Pipeline Builder</>, "Builder DSL + Element 注册表 + 3 条 pipeline", "1.5 周"],
            [<><Badge color="orange">P5</Badge> Core HTTP + WS</>, "服务器 + WebSocket 事件协议 + Replay 系统", "1 周"],
            [<><Badge color="orange">P6</Badge> Gateway</>, "Auth + 权限 + 速率限制 + 代理", "0.5 周"],
            [<><Badge color="purple">P7</Badge> TUI</>, "WebSocket 客户端 + 流式渲染 + Session 管理", "1 周"],
            [<><Badge color="green">P8</Badge> 集成</>, "E2E 测试 + 文档 + 部署配置", "0.5 周"],
          ]}
        />
        <Callout type="tip" title="总计">
          约 <strong>8 周</strong>完成 v2 完整实现。
        </Callout>
      </Section>
    </div>
  );
}
