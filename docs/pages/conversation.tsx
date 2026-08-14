import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

const elementGroups = [
  ["1", "读取消息", "collect-prompts", "blue"],
  ["2", "记录 Context", "record-context", "purple"],
  ["3", "应用 Source", "apply-source-context", "purple"],
  ["4", "编译 Snapshot", "collect-context", "purple"],
  ["5", "手工 Tool Loop", "stream-llm", "orange"],
  ["6", "计算预算", "token-ratio", "orange"],
  ["7", "决定续跑", "check-follow-up", "blue"],
  ["8", "统一收口", "finalize", "green"],
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

      <Section title="当前 8 个 Element 的主链">
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

      <Section title="Conversation ToolsGroup">
        <CodeBlock lang="text" code={`first recordable Tool result → create ToolsGroupID
  → Tool success / real Tool failure: assign Step 1..N
  → Guard / Runtime / history query Tool: no record, no Step
  → final Assistant text: seal Group
  → next Conversation: new Group, Step restarts at 1`} />
        <Callout type="info" title="TOON 摘要不是完整审计">
          有界的完整 input/output 保存在 ToolRecordStore，超限会标记 truncated；下一次 Snapshot 只注入 Group 和最近记录摘要。
          LLM 需要具体步骤时调用 <code>request_tool_record</code> 或 <code>request_tool_records</code>，
          两个查询 Tool 都不会记录自身。
        </Callout>
      </Section>

      <Section title="送入 LLM 的三条通道">
        <ComparisonTable
          headers={["通道", "承载内容", "边界"]}
          rows={[
            [<Badge color="purple">system</Badge>, "唯一 TOON Context Snapshot；内部包含 System Prompt、AGENTS、Skill 等 entries", <><code>system = snapshot.content</code></>],
            [<Badge color="blue">messages</Badge>, "可见的 user / assistant 历史与当前输入", "过滤孤立 role:tool"],
            [<Badge color="orange">tools</Badge>, "全部 schema 始终开放，由 LLM 自主选择", "Atom 只执行 Tool 并保护循环边界"],
          ]}
        />
        <CodeBlock lang="text" code={`Prompt Registry + AGENTS + Skill + runtime sources
  → ContextService entries
  → collect-context compiles one TOON Context Snapshot
  → system: snapshot.content

Session visible messages + current input → messages
Tool registry → schema-only definitions  → AI SDK Tool Calls
Tool executors + ToolGuard + Ledger       → Atom Tool Loop`} />
      </Section>

      <Section title="AI SDK 与 Atom 的职责边界">
        <CodeBlock lang="text" code={`streamText（单 step）
  → Tool Call schema validation
  → Atom Ledger reserves execution
  → Atom ToolRunner executes
  → Tool Call + Tool Result returned to the next model step
  → metadata.effect updates logs and no-progress warning only
  → final Assistant text only`} />
        <ComparisonTable
          headers={["职责", "所有者"]}
          rows={[
            ["模型适配、流式解析、Tool Call 参数校验", <Badge color="orange">AI SDK</Badge>],
            ["安全权限、完全重复检测与执行上限", <Badge color="blue">Atom</Badge>],
            ["Tool 选择、结果解释与下一步判断", <Badge color="purple">LLM</Badge>],
            ["最终回复与 Session 持久化", <Badge color="green">Atom</Badge>],
          ]}
        />
      </Section>

      <Section title="Tool 自主调用与循环保护">
        <CodeBlock lang="text" code={`Prediction → structured classification only
Conversation LLM → Memory / Skill / MCP / WebFetch / Filesystem
  ├─ same-name batch → validate opt-in, then execute calls in order
  ├─ mixed/non-batchable multi-call → reject the whole batch before execution
  ├─ normal call → execute and return full Tool Result
  ├─ repeated no-result → add a judgment warning; keep tools available
  ├─ exact duplicate → block the duplicate and explain why
  └─ execution limit → end the Tool Loop`} />
        <ComparisonTable
          headers={["状态", "框架行为"]}
          rows={[
            ["合法同名批次", "按 Call 顺序执行，收齐结果后进入下一 step"],
            ["混合或非批量多调用", "整批拒绝，每个 call_id 返回配对错误"],
            ["正常 Tool 调用", "不筛选、不改写、不隐藏结果"],
            ["连续无结果", "只提示 LLM 重新判断，不停机"],
            ["完全重复调用", "阻止重复执行，返回循环提示"],
            ["达到执行上限", "停止 Tool Loop，让 LLM 收尾"],
          ]}
        />
        <Callout type="tip" title="顺序治理，不做业务路由">
          Prompt 要求 LLM 在 WebFetch 前先查询 Memory 与 Skill；框架不维护业务前置状态，
          也不判断 Tool 是否与任务相关。同名批次校验只阻止混合执行和部分副作用。
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
            ["工具循环", <><code>ToolCallLedger</code> 控制手工循环，默认 50 次执行、连续 3 次无进展</>],
            ["输出预算", <><code>maxOutputTokens</code> 由系统配置，默认 4096；压缩阈值预留这部分空间</>],
            ["完成标记", <><code>&lt;&lt;&lt;COMPLETE&gt;&gt;&gt;</code> 用滑动窗口跨 chunk 识别，标记后文本丢弃</>],
            ["Unicode", <><code>String.toWellFormed()</code> 修复孤立代理；截断统一使用 <code>substringWellFormed</code></>],
            ["工具结果", "所有 Call + Result 返回当前 Conversation；真实执行另存 ToolRecord，Guard/Runtime 不记录"],
            ["无进展", "只提示；不收窄 Tool，不丢弃最终文本"],
          ]}
        />
      </Section>
    </div>
  );
}
