import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ── File Naming ── */}
      <Section title="文件命名">
        <CodeBlock lang="text" code={`# Lowercase kebab-case
element-name.ts          # Element implementation
element-name.test.ts     # Corresponding test
types.ts                 # Type definitions
index.ts                 # Barrel exports

# Pipeline definitions: one directory per pipeline
pipelines/
├── conversation/
│   ├── index.ts
│   ├── types.ts
│   └── elements/
│       ├── collect-prompts.element.ts
│       └── finalize.element.ts
└── prediction/
    └── ...`} />
        <Callout type="info" title="文件命名规则">
          全部使用 <strong>lowercase kebab-case</strong>。Element 文件名以 <code>.element.ts</code> 结尾。Pipeline 定义使用独立目录。
        </Callout>
      </Section>

      {/* ── Semantic Function Prefixes ── */}
      <Section title="语义函数前缀">
        <ComparisonTable
          headers={["前缀", "含义", "使用场景", "示例"]}
          rows={[
            [<Badge color="blue">create</Badge>, "从无到有创建实体", "工厂函数、构造辅助", <code>createTaskItem()</code>],
            [<Badge color="blue">build</Badge>, "组装现有部件", "从已有数据拼装复杂对象", <code>buildTransportPayload()</code>],
            [<Badge color="blue">parse</Badge>, "文本 → 结构化数据", "解析/反序列化", <code>parseIntentRequest()</code>],
            [<Badge color="blue">resolve</Badge>, "查找/决策", "从配置或策略中确定值", <code>resolveIntentPolicy()</code>],
            [<Badge color="blue">normalize</Badge>, "规范化输入", "清理/默认值/裁剪", <code>normalizeConfig()</code>],
            [<Badge color="blue">validate</Badge>, "校验并返回结果", "返回 {`{ ok, error? }`}", <code>validateTaskPayload()</code>],
            [<Badge color="green">apply</Badge>, "结果写入状态", "副作用操作", <code>applyExecutionResult()</code>],
            [<Badge color="green">emit</Badge>, "发送事件", "向 EventBus 发送消息", <code>emitTaskCompleted()</code>],
            [<Badge color="green">register</Badge>, "注册到容器", "Service/Tool/Element 注册", <code>registerTool()</code>],
            [<Badge color="green">export</Badge>, "从内部数据源导出", "Prompt 生成", <code>exportSystemPrompt()</code>],
            [<Badge color="green">report</Badge>, "非阻塞报告/日志", "调试、分析、审计", <code>reportMemoryUsage()</code>],
            [<Badge color="orange">off*</Badge>, "存储取消函数", "eventBus.on() 返回值", <code>offDelta</code>],
          ]}
        />
        <Callout type="tip" title="前缀思维模型">
          <div className="prefix-diagram">
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "center", marginBottom: "12px" }}>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-accent, #6366f1)", color: "#fff", fontSize: "13px" }}>create</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-accent, #6366f1)", color: "#fff", fontSize: "13px" }}>build</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-accent, #6366f1)", color: "#fff", fontSize: "13px" }}>parse</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-accent, #6366f1)", color: "#fff", fontSize: "13px" }}>resolve</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-accent, #6366f1)", color: "#fff", fontSize: "13px" }}>normalize</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-accent, #6366f1)", color: "#fff", fontSize: "13px" }}>validate</span>
            </div>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "center", marginBottom: "12px" }}>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-success, #22c55e)", color: "#000", fontSize: "13px" }}>apply</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-success, #22c55e)", color: "#000", fontSize: "13px" }}>emit</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-success, #22c55e)", color: "#000", fontSize: "13px" }}>register</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-success, #22c55e)", color: "#000", fontSize: "13px" }}>export</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-success, #22c55e)", color: "#000", fontSize: "13px" }}>report</span>
            </div>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "center" }}>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-warning, #f59e0b)", color: "#000", fontSize: "13px" }}>onXxx</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-warning, #f59e0b)", color: "#000", fontSize: "13px" }}>offXxx</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-danger, #ef4444)", color: "#fff", fontSize: "13px" }}>isXxx</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-danger, #ef4444)", color: "#fff", fontSize: "13px" }}>hasXxx</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-danger, #ef4444)", color: "#fff", fontSize: "13px" }}>canXxx</span>
              <span style={{ padding: "6px 12px", borderRadius: "6px", background: "var(--color-danger, #ef4444)", color: "#fff", fontSize: "13px" }}>shouldXxx</span>
            </div>
          </div>
        </Callout>
      </Section>

      {/* ── Class Naming ── */}
      <Section title="类命名">
        <ComparisonTable
          headers={["类型", "命名规则", "示例"]}
          rows={[
            ["普通类", "PascalCase", <code>PipelineRunner</code>, <code>TaskEngine</code>, <code>SessionContext</code>],
            ["抽象基类", "Base 前缀", <code>BaseElement&lt;I, O&gt;</code>, <code>BaseService</code>],
            ["Element 类", "描述名 + Element 后缀", <code>CollectPromptsElement</code>, <code>FinalizeConversationElement</code>],
            ["Service 类", "描述名 + Service 后缀", <code>MemoryService</code>, <code>ToolService</code>],
          ]}
        />
      </Section>

      {/* ── Type Naming ── */}
      <Section title="类型命名">
        <CodeBlock lang="typescript" code={`// Types/Interfaces: PascalCase, descriptive
type TaskItem = { ... }
type PipelineResult = { ... }
type PipelineContext = { ... }

// Discriminated unions: the discriminant field is always \`mode\` or \`type\`
type FlowState = { mode: Mode; ... } | { mode: Mode; ... }
type PipelineResult = { type: Type; ... } | { type: Type; ... }

// Enum members: PascalCase
enum PipelineResultType {
  Complete = "complete",
  Enqueue = "enqueue",
}

// Mode enums (for FlowState): PipelineName + Mode suffix
enum FormalConversationMode { ... }
enum PostFollowUpMode { ... }

// Generic type parameters: single uppercase letter, or descriptive if needed
class Pipeline<I, O> { }
class EventBus<TEvents extends Record<string, any>> { }
class Builder<TElement extends BaseElement> { }`} />
      </Section>

      {/* ── Variable Naming ── */}
      <Section title="变量命名">
        <ComparisonTable
          headers={["变量类型", "规则", "示例"]}
          rows={[
            ["局部变量", "camelCase", <code>taskQueue</code>, <code>eventBus</code>],
            ["私有字段", "# 前缀 (ES2022)", <code>#runtime</code>, <code>#config</code>],
            ["模块级常量", "UPPER_SNAKE_CASE", <code>MAX_OUTPUT_TOKENS</code>, <code>READY_TO_FINALIZE</code>],
            ["布尔变量", "is/has/can/should 前缀", <code>isRunning</code>, <code>hasStreamedOutput</code>, <code>canExecute</code>, <code>shouldFallback</code>],
            ["解构参数", "保持属性名", <code>{`const { ctx, runtime } = params`}</code>],
          ]}
        />
        <CodeBlock lang="typescript" code={`// Private fields: # prefix (TypeScript private)
class MyElement {
  #runtime: Runtime;
  #config: ElementConfig;
}

// Constants: UPPER_SNAKE_CASE (at module level or for magic values)
const MAX_OUTPUT_TOKENS = 4096;
const READY_TO_FINALIZE = "ready_to_finalize";

// Boolean variables: is/has/can/should prefix
const isRunning = true;
const hasStreamedOutput = false;
const canExecute = task.state === TaskState.READY;
const shouldFallback = result.ok === false;

// Destructured parameters: use same name as property
constructor(params: { ctx: PipelineContext; runtime: Runtime }) {
  // NOT: const { ctx: context, runtime: rt } = params;
  // GOOD:
  const { ctx, runtime } = params;
}`} />
      </Section>

      {/* ── Function Naming ── */}
      <Section title="函数命名">
        <ComparisonTable
          headers={["用途", "命名规则", "示例"]}
          rows={[
            ["事件处理器", "on + EventName", <code>onTaskEnqueued(task)</code>, <code>onPipelineFinished(result)</code>],
            ["异步函数", 'NO 特殊后缀 (不加 Async)', <code>fetchData()</code>, <Badge color="red">NOT fetchDataAsync()</Badge>],
            ["布尔返回函数", "is/has/can/should 前缀", <code>isSearchHit(output)</code>, <code>hasPendingToolCalls(state)</code>],
            ["构造器工厂", "create 前缀", <code>createTaskItem()</code>, <code>createSessionContext(id)</code>],
          ]}
        />
        <Callout type="warn" title="常见反模式">
          <ul>
            <li><Badge color="red">DON'T</Badge> 异步函数加 <code>Async</code> 后缀 — <code>fetchData()</code> 而非 <code>fetchDataAsync()</code></li>
            <li><Badge color="red">DON'T</Badge> 使用缩写命名 — <code>ParseIntentRequestsElement</code> 而非 <code>PIRSElement</code></li>
            <li><Badge color="red">DON'T</Badge> 用 <code>get_</code> / <code>set_</code> 前缀 — 直接使用属性名</li>
          </ul>
        </Callout>
      </Section>

      {/* ── File Path Naming ── */}
      <Section title="文件路径命名">
        <CodeBlock lang="text" code={`packages/
├── core/src/session/context.ts    # NOT: session-context.ts, SessionContext.ts
├── core/src/tools/registry.ts     # NOT: tool-registry.ts, ToolRegistry.ts
├── core/src/pipelines/conversation/index.ts  # NOT: formal-conversation/
└── shared/src/types/task.ts       # NOT: TaskItem.ts, task-types.ts`} />
        <Callout type="info">
          文件路径使用 <strong>lowercase single-word</strong>，不要用 kebab-case 文件名（kebab-case 仅用于 Element 文件如 <code>collect-prompts.element.ts</code>）。
        </Callout>
      </Section>

      {/* ── Test Naming ── */}
      <Section title="测试命名">
        <CodeBlock lang="text" code={`# Test files: same name as source + .test.ts
runner.ts → runner.test.ts
task-queue.ts → task-queue.test.ts

# Test descriptions: plain English
test("completes task when pipeline returns success")  // GOOD
test("test pipeline success")                          // BAD

# describe blocks: module or class name
describe("PipelineRunner", () => { ... })
describe("TaskEngine", () => { ... })`} />
      </Section>
    </div>
  );
}
