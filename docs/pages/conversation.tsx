import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

const elementGroups = [
  ["1", "读取消息", "collect-prompts", "blue"],
  ["2", "记录 Context", "record-context", "purple"],
  ["3", "编译 Snapshot", "collect-context", "purple"],
  ["4", "执行模型", "stream-llm", "orange"],
  ["5", "计算预算", "token-ratio", "orange"],
  ["6", "决定续跑", "check-follow-up", "blue"],
  ["7", "统一收口", "finalize", "green"],
] as const;

export default function ConversationPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader
        title={title}
        description={description}
        category={category}
        readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))}
      />

      <Section title="当前 7 个 Element 的主链">
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "stretch" }}>
          {elementGroups.map(([step, name, detail, color], index) => (
            <React.Fragment key={name}>
              <div style={{ flex: "1 1 190px", padding: "12px", border: "1px solid var(--color-border, #334155)", borderRadius: "8px" }}>
                <div><Badge color={color}>{step}</Badge> <strong>{name}</strong></div>
                <div style={{ marginTop: "7px", fontSize: "12px", lineHeight: 1.6, color: "var(--color-muted, #6b7280)" }}>{detail}</div>
              </div>
              {index < elementGroups.length - 1 && <span style={{ alignSelf: "center", color: "var(--color-muted, #6b7280)" }}>→</span>}
            </React.Fragment>
          ))}
        </div>
        <Callout type="info" title="Finalize 只交付决策">
          Snapshot 的提交或释放在这里完成；下一任务要等 <code>Task.Completed</code> 保存 Assistant
          消息并完成 checkpoint、发出 <code>Task.Committed</code> 后才会放行。
        </Callout>
      </Section>

      <Section title="送入 LLM 的三条通道">
        <ComparisonTable
          headers={["通道", "承载内容", "边界"]}
          rows={[
            [<Badge color="purple">system</Badge>, "唯一 TOON Context Snapshot；内部包含 System Prompt、AGENTS、Skill 等 entries", <><code>system = snapshot.content</code></>],
            [<Badge color="blue">messages</Badge>, "可见的 user / assistant 历史与当前输入", "过滤孤立 role:tool"],
            [<Badge color="orange">tools</Badge>, "按意图筛选的工具定义；webfetch 始终可见", "执行资格由 ToolGuard 判定"],
          ]}
        />
        <CodeBlock lang="text" code={`Prompt Registry + AGENTS + Skill + runtime sources
  → ContextService entries
  → collect-context compiles one TOON Context Snapshot
  → system: snapshot.content

Session visible messages + current input → messages
Tool registry + intent selection          → tools`} />
      </Section>

      <Section title="Web 查询的能力发现顺序">
        <CodeBlock lang="text" code={`已有 Context / 查询方法 / Skill
  └─ Prediction.memoryQuery → 自动搜索 Memory
      ├─ 命中摘要 → read_memory → 普通方法可查询
      │                         └─ 含 Skill 线索 → skill_load / skill_section
      ├─ 空结果   → skill_list → 再次调用 webfetch
      └─ 服务异常 / 明确 URL → 直接允许 webfetch`} />
        <ComparisonTable
          headers={["状态", "ToolGuard 行为"]}
          rows={[
            ["尚未搜索 Memory", "拦截 webfetch，并要求先 search_memory"],
            ["Memory 命中 Skill 线索", "等待 Skill 成功加载；不存在或失败时允许降级"],
            ["Memory 为空且未检查 Skill", "拦截并要求 skill_list"],
            ["前置检查已完成 / 服务不可用 / 输入含 URL", "允许执行 webfetch"],
          ]}
        />
        <Callout type="tip" title="可见不等于可执行">
          Agent 始终知道 <code>webfetch</code> 存在；Guard 用可解释的结果提示缺少哪一步，而不是把工具从列表隐藏。
        </Callout>
      </Section>

      <Section title="一轮结束后的决策">
        <ComparisonTable
          headers={["结果", "触发条件", "下一步"]}
          rows={[
            [<Badge color="green">complete</Badge>, "正常完成且无 active TODO", "Conversation.Idle → post-conversation"],
            [<Badge color="blue">follow_up</Badge>, "长度截断、可恢复错误或显式续写意图", "无计划续写；达到检查点时交给 evaluator"],
            [<Badge color="purple">continue_todo</Badge>, "没有 follow_up，但仍有 pending / in_progress TODO", "按结构化计划继续；达到深度上限即停止"],
            [<Badge color="orange">post_check_retry</Badge>, "质量检查判定 blocked 且未停滞", "带 guidance 重试"],
            [<Badge color="red">compress</Badge>, "Token 使用超过保留输出预算后的有效阈值", "归档、摘要、checkpoint，再决定是否续写"],
          ]}
        />
      </Section>

      <Section title="提交顺序与输出边界">
        <CodeBlock lang="text" code={`stream result
  → finalize Snapshot receipt
  → Task.Completed
      → save Assistant + token usage
      → checkpoint Session
      → Task.Committed
      → Conversation.Chain 或 Conversation.Idle
      → release staged next task`} />
        <ComparisonTable
          headers={["边界", "当前实现"]}
          rows={[
            ["工具循环", <><code>stopWhen: stepCountIs(maxSteps)</code>，默认 50</>],
            ["输出预算", <><code>maxOutputTokens</code> 由系统配置，默认 4096；压缩阈值预留这部分空间</>],
            ["完成标记", <><code>&lt;&lt;&lt;COMPLETE&gt;&gt;&gt;</code> 用滑动窗口跨 chunk 识别，标记后文本丢弃</>],
            ["Unicode", <><code>String.toWellFormed()</code> 修复孤立代理；截断统一使用 <code>substringWellFormed</code></>],
            ["工具结果", "进入按 topic 管理的 ToolContext，下一轮注入后消费，不生成孤立 tool 消息"],
          ]}
        />
      </Section>
    </div>
  );
}
