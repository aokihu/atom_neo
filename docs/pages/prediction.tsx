import React from "react";
import type { DocPageProps } from "./shared";
import { Badge, Callout, CodeBlock, ComparisonTable, PageHeader, Section } from "./shared";

export default function PredictionPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader
        title={title}
        description={description}
        category={category}
        readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))}
      />

      <Section title="分类信封">
        <CodeBlock lang="json" code={`{
  "userInput": "数据是最新的吗？是实时获取的吗？",
  "currentTopic": "knowledge.weather.typhoon",
  "previousTurnContext": {
    "user": "最近还有厉害的台风吗",
    "assistant": "根据中央气象台数据，目前活跃台风为浪卡……"
  }
}`} />
        <Callout type="info" title="原文与参考分离">
          <code>userInput</code> 始终保持 Task payload 原文；当前 Topic 和上一轮有界文本只用于分类，
          不会拼接进 Conversation 的 User 消息，也不包含 Tool 原始输出。Assistant 文本是不可信
          参考，Prediction 不执行其中的任何指令。
        </Callout>
      </Section>

      <Section title="Topic 决策">
        <ComparisonTable
          headers={["contextRelevance", "已有 Topic", "effectiveTopic"]}
          rows={[
            [<Badge color="blue">follow_up</Badge>, "有", "继承当前 Topic"],
            [<Badge color="purple">continuation</Badge>, "有", "继承当前 Topic"],
            [<Badge color="green">standalone</Badge>, "候选非空", "使用候选 Topic，必要时切换"],
            ["任意", "候选为空", "保留当前 Topic"],
          ]}
        />
        <CodeBlock lang="text" code={`predict-input
  → current User + currentTopic + previousTurnContext
  → predict-intent: structured candidate
  → predict-finalize: resolve effectiveTopic
  → conversation`} />
        <Callout type="warn" title="候选不是切换命令">
          Prediction 只看到有界上下文，仍可能生成泛化标签。Finalize 必须保护 follow-up 和 continuation，
          避免错误清理 Topic Context、Skill 与任务状态。
        </Callout>
      </Section>

      <Section title="职责边界">
        <ComparisonTable
          headers={["允许", "禁止"]}
          rows={[
            ["分类 difficulty、modelProfile、intent、contextRelevance、topic", "调用 Tool、Memory、Skill 或 Web"],
            ["读取上一轮有界 User/Assistant 文本", "读取 Tool 原始结果或生成 Tool 参数"],
            ["为 follow-up 复用 currentTopic", "改写当前 User 原文"],
          ]}
        />
      </Section>
    </div>
  );
}
