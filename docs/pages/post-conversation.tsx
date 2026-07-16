import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function PostConversationPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader
        title={title}
        description={description}
        category={category}
        readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))}
      />

      <Section title="检查发生在持久化之后">
        <CodeBlock lang="text" code={`conversation.finalize: shouldPostCheck
  → Task.Completed 保存 Assistant 消息并 checkpoint
  → Task.Committed
  → Conversation.Idle
  → schedulePostConversation()
  → post-conversation pipeline`} />
        <Callout type="info" title="链式输出不插入检查">
          follow-up 或 TODO 续跑仍在进行时不会触发质量检查；HTTP 400 级不可恢复错误也直接跳过。
        </Callout>
      </Section>

      <Section title="3 个 Element 的判断链">
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          {[
            ["1", "post-collect-input", "提取用户请求、回复头尾和 TODO 元数据", "blue"],
            ["2", "post-analyze-result", "LLM 三态分析并生成行为指纹", "purple"],
            ["3", "post-finalize", "结束、等待用户，或安全重试", "green"],
          ].map(([step, name, detail, color], index, all) => (
            <React.Fragment key={name}>
              <div style={{ flex: "1 1 190px", padding: "12px", border: "1px solid var(--color-border, #334155)", borderRadius: "8px" }}>
                <div><Badge color={color as "blue" | "purple" | "green"}>{step}</Badge> <strong>{name}</strong></div>
                <div style={{ marginTop: "7px", fontSize: "12px", color: "var(--color-muted, #6b7280)" }}>{detail}</div>
              </div>
              {index < all.length - 1 && <span style={{ color: "var(--color-muted, #6b7280)" }}>→</span>}
            </React.Fragment>
          ))}
        </div>
        <Callout type="info" title="Source 必须保留 Task">
          <code>post-collect-input</code> 原样传递触发本 Pipeline 的 Task。blocked retry 使用真实
          <code>ownerTaskId</code> 暂存，并沿用 <code>chainId/rootTaskId</code>；缺失 Task 时直接失败，
          不能用空字符串绕过 checkpoint gate。
        </Callout>
      </Section>

      <Section title="三态决策矩阵">
        <ComparisonTable
          headers={["分析状态", "含义", "Finalize 行为"]}
          rows={[
            [<Badge color="green">satisfactory</Badge>, "回复已经提供实质结果", "结束，不重试"],
            [<Badge color="blue">needs_user_input</Badge>, "确实缺少用户才能提供的信息", "结束，等待用户补充"],
            [<Badge color="orange">blocked</Badge>, "任务未完成且没有合理阻塞原因", "计算指纹相似度，再决定 retry 或 stalled"],
          ]}
        />
        <CodeBlock lang="text" code={`blocked
  → 与历史 fingerprints 计算 trigram Jaccard
      ├─ max similarity > 0.6  → stalled，停止
      └─ max similarity ≤ 0.6  → 保存 fingerprint
                              → Conversation.Chain(post_check_retry)`} />
      </Section>

      <Section title="两道防循环保护">
        <ComparisonTable
          headers={["防线", "识别方式", "拦截结果"]}
          rows={[
            [<Badge color="blue">语义层</Badge>, <code>needs_user_input</code>, "追问和澄清不是失败，不自动重试"],
            [<Badge color="purple">统计层</Badge>, "行为指纹 trigram Jaccard > 0.6", "措辞不同但行为相同，判为 stalled"],
            [<Badge color="red">全局预算</Badge>, "chainDepth 达到 maxChainDepth（默认 5）", "停止 post_check_retry 链"],
          ]}
        />
        <Callout type="tip" title="比较的是行为，不是原句">
          “请问要查哪个城市”和“请告诉我城市名称”会被归一成相近的 fingerprint，避免换个说法继续空转。
        </Callout>
      </Section>

      <Section title="有限输入与失败兜底">
        <ComparisonTable
          headers={["输入或异常", "处理"]}
          rows={[
            ["短回复", "保留完整内容"],
            ["长回复", "保留回复开头和结尾，并附带分段数、TODO、finishReason、完成标记"],
            ["截断边界", <><code>substringWellFormed</code> 保证送入分析请求的是合法 Unicode</>],
            ["无 API Key / 无输入", "直接视为 satisfactory，不阻塞主对话"],
            ["LLM 调用或 JSON 解析失败", "fallback 为 satisfactory / skip"],
          ]}
        />
        <Callout type="ok" title="Fail-safe 优先">
          质量模型只负责发现可修复问题；自身故障不能把已经完成的主对话卡住。
        </Callout>
      </Section>
    </div>
  );
}
