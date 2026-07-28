import React from "react";
import type { DocPageProps } from "./shared";
import { Badge, Callout, CodeBlock, ComparisonTable, PageHeader, Section } from "./shared";

export default function ContextOutcomeGovernancePage({
  content,
  title,
  description,
  category,
}: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader
        title={title}
        description={description}
        category={category}
        readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))}
      />

      <Section title="一个结果，四个不同去向">
        <CodeBlock lang="text" code={`ToolResult
  ├─ conversation step   仅 progress 结果投影给模型
  ├─ ToolCallLedger      结构化 outcome，不注入模型
  ├─ Session audit       供日志和 TUI 诊断
  └─ ContextService      只有显式 contextInjection`} />
        <Callout type="info" title="丢弃不等于失明">
          error、empty 和 blocked 的 Call + Result 会整组从模型消息中删除；框架仍保留 Outcome、
          fingerprint 和 Guard 状态，并用最小 step instruction 与逐步收窄的 activeTools 控制下一步。
        </Callout>
      </Section>

      <Section title="框架可识别的 Outcome">
        <ComparisonTable
          headers={["状态", "进度", "当前循环", "跨轮 Context"]}
          rows={[
            [<Badge color="green">success</Badge>, "evidence / state_changed", "保留", "仅显式 Injection"],
            [<Badge color="orange">empty</Badge>, "none", "Call + Result 整组丢弃", "丢弃"],
            [<Badge color="red">error</Badge>, "none", "Call + Result 整组丢弃", "丢弃"],
            [<Badge color="purple">blocked / deferred</Badge>, "none", "Call + Result 整组丢弃", "丢弃"],
            [<Badge color="blue">cancelled</Badge>, "none", "Call + Result 整组丢弃", "丢弃"],
          ]}
        />
        <CodeBlock lang="ts" code={`type ToolOutcome = {
  status: "success" | "empty" | "error" | "blocked" | "deferred" | "cancelled";
  progress: "evidence" | "state_changed" | "none";
  evidenceWeight?: "primary" | "reference";
  code?: string;
};`} />
      </Section>

      <Section title="三条消费链的权重">
        <ComparisonTable
          headers={["Pipeline", "主事实", "Assistant 的角色", "防污染动作"]}
          rows={[
            ["Prediction", "最近 User 请求", "低预算 reference", "与 User 历史分字段"],
            ["Post", "User 请求 + Tool evidence", "待验证 claim", "重试建议保持 untrusted"],
            ["Compact", "User 决策 + verified evidence", "未验证叙述", "无效结果不进入摘要输入"],
          ]}
        />
      </Section>

      <Section title="六阶段小步实施">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px" }}>
          {[
            ["1", "契约", "Outcome 类型与 legacy 归一化"],
            ["2", "执行", "schema-only SDK + 手工 Tool Loop"],
            ["3", "迁移", "内置 Tool 显式标注"],
            ["4", "判断", "Prediction 与 Post 权重"],
            ["5", "压缩", "筛选与事实优先摘要"],
            ["6", "验证", "单测、构建与日志回归"],
          ].map(([step, name, detail]) => (
            <div key={step} style={{ border: "1px solid var(--color-border, #334155)", borderRadius: "8px", padding: "12px" }}>
              <div><Badge color="blue">{step}</Badge> <strong>{name}</strong></div>
              <div style={{ marginTop: "7px", color: "var(--color-muted, #6b7280)", fontSize: "12px" }}>{detail}</div>
            </div>
          ))}
        </div>
        <Callout type="ok" title="迁移策略">
          内置 Tool 和 MCP 都由 Atom 手工执行；只有成功的 MCP 原始结果在当前 conversation 后续
          steps 中按 reference evidence 可见，失败和空结果不会投影给模型。
        </Callout>
      </Section>

      <Section title="验收红线">
        <ComparisonTable
          headers={["场景", "必须满足"]}
          rows={[
            ["连续空搜索", "不算进展、不写持久 Context，并触发 no-progress 保护"],
            ["搜索词改变并命中", "evidence 解除重复保护，后续可正常完成"],
            ["Assistant 错误结论", "不能覆盖 User 请求或 Tool evidence"],
            ["Compact", "不把 error/empty 重新总结成事实"],
            ["显式 Memory/Skill 投影", "保持既有 scope、TTL、pin 与 trust 语义"],
          ]}
        />
      </Section>
    </div>
  );
}
