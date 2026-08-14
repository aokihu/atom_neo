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
  ├─ conversation step   所有已执行结果均投影
  ├─ ToolCallLedger      消费 metadata，不注入模型
  ├─ ToolRecordStore     只记录真实执行成功/失败
  └─ ContextService      显式 Injection + ToolRecord 摘要`} />
        <Callout type="info" title="当前轮完整，跨轮克制">
          失败和 effect:none 的 Call + Result 也会返回当前 Conversation；Conversation 结束后，
          普通 Tool Result 不自动进入 Topic/Session Context。所有 Tool 始终开放，Memory 与 Skill
          的优先顺序由 Prompt 要求 LLM 遵守。
        </Callout>
      </Section>

      <Section title="最小 ToolResult">
        <ComparisonTable
          headers={["effect", "含义", "当前循环", "跨轮 Context"]}
          rows={[
            [<Badge color="green">evidence</Badge>, "主要证据", "投影 content", "仅显式 Injection"],
            [<Badge color="purple">reference</Badge>, "MCP / Memory 当前轮参考", "投影 content", "默认丢弃"],
            [<Badge color="blue">state_changed</Badge>, "状态变更", "按需投影 content", "仅显式 Injection"],
            [<Badge color="orange">none</Badge>, "没有可用结果", "投影空结果", "不持久化"],
          ]}
        />
        <CodeBlock lang="ts" code={`type ToolResult = {
  content?: unknown;
  metadata:
    | { ok: true; effect: "none" | "reference" | "evidence" | "state_changed";
        contextInjection?: ToolContextInjection }
    | { ok: false; effect: "none"; error: string;
        errorSource: "guard" | "runtime" | "tool" };
};`} />
      </Section>

      <Section title="ToolsGroup：摘要常驻，详情按需">
        <CodeBlock lang="text" code={`Conversation A → tg-A-1, tg-A-2, tg-A-3
Conversation B → tg-B-1, tg-B-2

只有真实 Tool 成功/失败分配 Step
Guard、Runtime、request_tool_record(s) 不记录、不占 Step`} />
        <ComparisonTable
          headers={["数据", "保存位置", "进入 Context"]}
          rows={[
            ["有界完整 input/output/error", "ToolRecordStore；超限标记 truncated", "否，按需查询"],
            ["Group + 最近记录摘要", "ContextService tool channel", "由 compiler 编码为 TOON"],
            ["Guard / Runtime 错误", "Runtime 日志", "否"],
            ["历史查询结果", "当前 modelMessages", "仅当前 Conversation"],
          ]}
        />
      </Section>

      <Section title="三条消费链的权重">
        <ComparisonTable
          headers={["Pipeline", "主事实", "Assistant 的角色", "防污染动作"]}
          rows={[
            ["Prediction", "当前 User 原文", "不读取 Assistant", "Output.object 结构化分类"],
            ["Post", "User 请求 + Tool evidence", "待验证 claim", "重试建议保持 untrusted"],
            ["Compact", "User 决策 + verified evidence", "未验证叙述", "无效结果不进入摘要输入"],
          ]}
        />
      </Section>

      <Section title="六阶段小步实施">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px" }}>
          {[
            ["1", "契约", "content 与 metadata 两层"],
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
          内置 Tool 和 MCP 都由 Atom 手工执行；正常 Tool Result 不按 effect 过滤，空结果与失败也会
          返回当前 Conversation，但不会自动进入跨轮 Context。
        </Callout>
      </Section>

      <Section title="验收红线">
        <ComparisonTable
          headers={["场景", "必须满足"]}
          rows={[
            ["同 step 混合 Tool", "执行前整批拒绝，所有 Call 保持结果配对"],
            ["非 batchable Tool 多调用", "整批拒绝，不产生部分状态变更"],
            ["合法同名查询批次", "顺序执行，收齐结果后才能切换 Tool"],
            ["连续空搜索", "不写持久 Context，只提示模型重新判断"],
            ["完全重复调用", "阻止重复执行并返回循环提示"],
            ["正常 Tool Result", "完整返回当前 Conversation，不由框架筛选"],
            ["Assistant 错误结论", "不能覆盖 User 请求或 Tool evidence"],
            ["Compact", "不把失败或 effect:none 结果重新总结成事实"],
            ["显式 Memory/Skill 投影", "保持既有 scope、TTL、pin 与 trust 语义"],
            ["ToolRecord 历史", "Group/Step 可定位；Context 只含 TOON 摘要；详情查询不自记录"],
          ]}
        />
      </Section>
    </div>
  );
}
