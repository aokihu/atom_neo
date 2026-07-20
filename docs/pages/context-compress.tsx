import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function ContextCompressPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader
        title={title}
        description={description}
        category={category}
        readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))}
      />

      <Callout type="info" title="压缩对象只有 Context 和 Messages">
        Context Compress 不搜索、不读取也不压缩 Memory。手动 /compact 完成 checkpoint 与清理后直接结束，
        不会为了汇报结果启动普通 Conversation。
      </Callout>

      <Section title="触发来源与恢复边界">
        <ComparisonTable
          headers={["trigger", "来源", "resumeConversation", "完成后的行为"]}
          rows={[
            [<code>manual</code>, "用户执行 /compact", <Badge color="green">false</Badge>, "安静结束，不启动 Memory / History 工具链"],
            [<code>token-overflow</code>, "Conversation 上下文溢出", <Badge color="orange">true</Badge>, "恢复被中断的原任务"],
            [<code>context-pressure</code>, "Evaluator 检测到上下文压力", <Badge color="orange">true</Badge>, "压缩后继续原任务"],
          ]}
        />
      </Section>

      <Section title="Pipeline 数据流">
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          {[
            ["1", "Input", "选择完整消息前缀"],
            ["2", "Archive", "写不可变 JSONL"],
            ["3", "Summarize", "生成累计摘要"],
            ["4", "Finalize", "checkpoint 后清理"],
          ].map(([step, name, detail], index, all) => (
            <React.Fragment key={name}>
              <div style={{ padding: "10px 12px", border: "1px solid var(--color-border, #334155)", borderRadius: "8px", minWidth: "150px" }}>
                <div><Badge color="blue">{step}</Badge> <strong>{name}</strong></div>
                <div style={{ marginTop: "5px", fontSize: "12px", color: "var(--color-muted, #6b7280)" }}>{detail}</div>
              </div>
              {index < all.length - 1 && <span style={{ color: "var(--color-muted, #6b7280)" }}>→</span>}
            </React.Fragment>
          ))}
        </div>
        <Callout type="warn" title="原始消息是最后删除的数据">
          Archive、Summary 或 checkpoint 任一阶段失败，都必须保留 Session 内存中的原始消息，也不能调度续写。
        </Callout>
      </Section>

      <Section title="FlowState 状态机">
        <CodeBlock lang="text" code={`initial
  → archiving
      ├─ archiveError → finalizing → stop
      └─ archiveReceipt → summarizing
          ├─ summaryError → finalizing → stop
          └─ summary → finalizing → checkpoint
              ├─ manual → complete
              └─ overflow / pressure → continue`} />
        <ComparisonTable
          headers={["字段", "用途", "安全意义"]}
          rows={[
            [<code>request</code>, "触发来源与是否恢复 Conversation", "阻止手动 compact 进入 Memory / History 工具链"],
            [<code>archiveMessages</code>, "归档与删除的同一批原始消息", "禁止先过滤再按数量删除"],
            [<code>summaryMessages</code>, "摘要可见的 user/assistant 消息", "内部消息仍保留在归档"],
            [<code>archiveReceipt</code>, "归档分段回执", "只有成功时才更新索引"],
            [<code>archiveError</code>, "归档失败", "阻止 checkpoint 和清理"],
            [<code>summaryError</code>, "摘要失败或空结果", "阻止破坏性提交"],
            [<code>summaryMaxTokens</code>, "摘要输出预算", "按压缩比动态取 400–1600"],
          ]}
        />
      </Section>

      <Section title="5 档压缩策略">
        <ComparisonTable
          headers={["compressRatio", "保留消息", "摘要 Token", "强度"]}
          rows={[
            ["< 0.3", "20", "400", <Badge color="green">轻度</Badge>],
            ["0.3–0.6", "10", "600", <Badge color="blue">中度</Badge>],
            ["0.6–0.9", "5", "800", <Badge color="purple">强力</Badge>],
            ["0.9–1.2", "2", "1200", <Badge color="orange">激进</Badge>],
            ["≥ 1.2", "1", "1600", <Badge color="red">极限</Badge>],
          ]}
        />
        <Callout type="info" title="保留输出空间">
          触发阈值使用 effectiveLimit = contextLimit - maxOutputTokens，不会等到模型完全耗尽输出预算才压缩。
        </Callout>
      </Section>

      <Section title="归档、Snapshot 与续写">
        <CodeBlock lang="text" code={`message-000001.jsonl  ← 原始冷历史，不可变
conversation-summary    ← 覆盖全部冷历史的累计摘要
history-archive-index   ← 分段范围与查询指引
message-latest.jsonl    ← 仍在 Session 中的最近消息`} />
        <ComparisonTable
          headers={["需求", "Agent 使用的数据"]}
          rows={[
            ["继续普通对话", "Snapshot 中的累计摘要 + 最近消息"],
            ["查找原始决策", <code>search_history</code>],
            ["核对精确原文", <code>read_history</code>],
            ["自动压缩后续写", "专用“从截断处继续”指令，不重复原始用户请求"],
            ["手动 /compact", "只提交 Context / Messages 变更，不续写"],
          ]}
        />
      </Section>

      <Section title="压缩日志">
        <ComparisonTable
          headers={["阶段", "关键字段", "回答的问题"]}
          rows={[
            ["Request", <code>trigger, target, resumeConversation</code>, "为什么压缩、压缩什么、是否续写"],
            ["Plan", <code>contextTokens, totalMessages, visibleMessages, safeCount</code>, "输入规模和安全边界是什么"],
            ["Archive", <code>archiveId, count, fromSeq, toSeq</code>, "哪些 Messages 被归档"],
            ["Summary", <code>summaryMessages, inputChars, summaryLen, maxTokens</code>, "哪些内容参与 Context 摘要"],
            ["Commit", <code>removedMessages, remainingMessages, contextSummaryUpdated</code>, "Context / Messages 实际发生了什么"],
            ["Tokens", <code>previousContextTokens, snapshotTokens, messageTokens, contextTokens</code>, "压缩后当前窗口降到了多少"],
          ]}
        />
      </Section>

      <Section title="失败边界">
        <ComparisonTable
          headers={["失败点", "保留", "禁止"]}
          rows={[
            ["Archive", "全部内存消息", "checkpoint、删除、续写"],
            ["Summary", "全部内存消息 + 已写归档", "checkpoint、删除、续写"],
            ["Checkpoint", "全部内存消息 + 冷归档", "删除、续写"],
            ["无可归档消息", "现有 Session", "无意义的重试循环"],
          ]}
        />
      </Section>
    </div>
  );
}
