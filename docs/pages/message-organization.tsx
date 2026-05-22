import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function MessageOrganizationPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={5} />

      {/* ── Architecture Overview ── */}
      <Section title="Message 组装架构">
        <Callout type="info" title="格式">
          所有 Message 遵循 AI SDK 标准格式：<code>{'{ role: "system" | "user" | "assistant", content: string }'}</code>
        </Callout>

        <CodeBlock lang="typescript" code={`messages = [
  { role: "system",    content: baseSystemPrompt },   // 第1层：安全提示词
  { role: "system",    content: contextData },        // 第2层：上下文元数据
  { role: "user",      content: "历史消息1" },
  { role: "assistant", content: "历史回复1" },
  { role: "user",      content: "当前输入" },
]`} />

        <ComparisonTable
          headers={["层级", "作用", "来源", "加载方式"]}
          rows={[
            ["第 1 层 system", "安全边界", <code>src/assets/prompts/base_system_prompt.md</code>, <><Badge color="green">static import</Badge> 打包时内联</>],
            ["第 2 层 system", "上下文数据", "运行时动态收集", <><Badge color="orange">runtime</Badge> 时间/目录/记忆</>],
            ["会话历史", "多轮记忆", "SessionContext", "CollectPrompts 提取"],
            ["当前输入", "用户消息", "TaskItem.payload", "FormatMessages 追加"],
          ]}
        />
      </Section>

      {/* ── Pipeline Chain ── */}
      <Section title="Pipeline Element 链（7 Element）">
        <div style={{ fontFamily: "monospace", fontSize: "13px", lineHeight: "2" }}>
          <div><Badge color="blue">source</Badge>   collect-prompts      — initial → streaming</div>
          <div><Badge color="green">transform</Badge> <strong>load-system-prompt</strong> — streaming (no mode change)</div>
          <div><Badge color="green">transform</Badge> <strong>collect-context</strong>    — streaming (no mode change)</div>
          <div><Badge color="green">transform</Badge> <strong>format-messages</strong>    — streaming → formatted</div>
          <div><Badge color="green">transform</Badge> stream-llm           — formatted → executing</div>
          <div><Badge color="orange">boundary</Badge>  check-follow-up      — executing → ready_to_finalize</div>
          <div><Badge color="red">sink</Badge>     finalize             — ready_to_finalize → PipelineResult</div>
        </div>

        <Callout type="tip" title="模式切换点">
          前三个 Element 在 <code>streaming</code> mode 下累积数据（不切换），<code>format-messages</code> 收敛后切换为 <code>formatted</code>。
          <code>stream-llm</code> 门控从 <code>streaming</code> 改为 <code>formatted</code>。
        </Callout>
      </Section>

      {/* ── Element 1: load-system-prompt ── */}
      <Section title="load-system-prompt（新增）">
        <Callout type="info" title="静态导入">
          Bun 原生支持 <code>import ... from "*.md"</code>，将 Markdown 文件作为 <code>string</code> 类型导入。
          打包为二进制时内容直接内联，无需运行时文件读取。
        </Callout>

        <CodeBlock lang="typescript" code={`// Static import — Bun natively supports .md as text
import baseSystemPrompt from "./assets/prompts/base_system_prompt.md";

class LoadSystemPromptElement extends BaseElement {
  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    return {
      ...input,
      systemPrompt: baseSystemPrompt,  // 写入 FlowState
    };
  }
}`} />
      </Section>

      {/* ── Element 2: collect-context ── */}
      <Section title="collect-context（新增）">
        <CodeBlock lang="typescript" code={`class CollectContextElement extends BaseElement {
  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const contextData = [
      \`Current Time: \${new Date().toISOString()}\`,
      \`Working Directory: \${process.cwd()}\`,
      \`OS: \${process.platform} \${process.arch}\`,
      // TODO: MemoryService 查询长期记忆
    ].join("\\n");

    return { ...input, contextData };
  }
}`} />
      </Section>

      {/* ── Element 3: format-messages ── */}
      <Section title="format-messages（修改）">
        <Callout type="warn" title="模式切换">
          这是唯一切换 mode 的 transform Element — <code>streaming → formatted</code>
        </Callout>

        <CodeBlock lang="typescript" code={`class FormatMessagesElement extends BaseElement {
  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const messages: Message[] = [];

    // 第1层：安全提示词
    if (input.systemPrompt) {
      messages.push({ role: "system", content: input.systemPrompt });
    }

    // 第2层：上下文数据
    if (input.contextData) {
      messages.push({ role: "system", content: input.contextData });
    }

    // 第3层：会话历史
    for (const m of input.prompts ?? []) {
      messages.push({ role: m.role, content: m.content });
    }

    // 第4层：当前用户输入
    const text = input.task?.payload?.[0]?.data;
    if (text) messages.push({ role: "user", content: text });

    return { ...input, mode: "formatted", messages };
  }
}`} />
      </Section>

      {/* ── FlowState ── */}
      <Section title="FlowState 类型扩展">
        <CodeBlock lang="typescript" code={`type ConversationFlowState = {
  mode: "initial" | "streaming" | "formatted"
      | "executing" | "ready_to_finalize";

  // 新增字段（3 个 Element 写入）
  systemPrompt?: string;    // load-system-prompt → 写入
  contextData?: string;     // collect-context → 写入
  messages?: Message[];     // format-messages → 组装后

  // 原有字段
  task: TaskItem;
  prompts?: PromptItem[];
  responseText?: string;
  followUp?: FollowUpData;
};`} />
      </Section>

      {/* ── System Prompt ── */}
      <Section title="System Prompt 内容规范">
        <Callout type="ok" title="文件位置">
          <code>src/assets/prompts/base_system_prompt.md</code> — 中文编写
        </Callout>

        <CodeBlock lang="markdown" code={`你是一个 AI 开发助手，运行在原子(Atom)开发平台上。

## 安全边界
- 永远不要执行可能损坏系统或数据的命令
- 拒绝生成恶意代码、漏洞利用、或协助非法活动
- 操作文件前确认用户意图

## 行为准则
- 使用中文回复
- 不确定时主动询问用户确认`} />
      </Section>
    </div>
  );
}
