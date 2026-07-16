import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function PromptsPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader
        title={title}
        description={description}
        category={category}
        readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))}
      />

      <Section title="Prompt Registry 的分层结构">
        <CodeBlock lang="text" code={`prompts/
├── keys.ts                 统一 PromptKey
├── model_profiles.ts       Provider 语言与模型映射
├── variants/lang/          zh / en 完整基础提示词
├── variants/models/        按模型选择性追加文本
├── registry.ts             注册、合成、缓存
└── index.ts                resolvePrompt() 公共入口`} />
        <Callout type="info" title="一个稳定入口">
          Pipeline 只按 key 和当前 provider/model 调用 <code>resolvePrompt()</code>，不再各自维护内嵌提示词。
        </Callout>
      </Section>

      <Section title="一次 resolve 的合成路径">
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          {[
            ["1", "生成 cache key", "key + provider + model", "blue"],
            ["2", "选择语言", "Provider → zh / en", "purple"],
            ["3", "读取基础版", "语言层提供完整 Prompt", "green"],
            ["4", "选择性追加", "模型层只补充已定义 key", "orange"],
            ["5", "缓存结果", "后续 O(1) 命中", "blue"],
          ].map(([step, name, detail, color], index, all) => (
            <React.Fragment key={name}>
              <div style={{ flex: "1 1 140px", padding: "11px", border: "1px solid var(--color-border, #334155)", borderRadius: "8px" }}>
                <div><Badge color={color as "blue" | "purple" | "green" | "orange"}>{step}</Badge> <strong>{name}</strong></div>
                <div style={{ marginTop: "6px", fontSize: "12px", color: "var(--color-muted, #6b7280)" }}>{detail}</div>
              </div>
              {index < all.length - 1 && <span style={{ color: "var(--color-muted, #6b7280)" }}>→</span>}
            </React.Fragment>
          ))}
        </div>
        <CodeBlock lang="text" code={`final prompt = language base
             + (model refinement ? "\\n\\n" + refinement : "")`} />
        <Callout type="tip" title="模型层不替换基础版">
          模型文件只定义确实需要微调的 PromptKey；未定义或空字符串都直接跳过。
        </Callout>
      </Section>

      <Section title="Provider 与输出语言">
        <ComparisonTable
          headers={["Provider", "基础语言", "行为"]}
          rows={[
            [<code>deepseek</code>, <Badge color="green">zh</Badge>, "使用中文完整基础提示词"],
            [<code>openai</code>, <Badge color="blue">en</Badge>, "使用英文完整基础提示词"],
            [<code>anthropic</code>, <Badge color="blue">en</Badge>, "使用英文完整基础提示词"],
            ["未知 Provider", <Badge color="orange">en</Badge>, "回退英文基础版"],
          ]}
        />
      </Section>

      <Section title="缓存生命周期">
        <CodeBlock lang="text" code={`server startup
  → registerAllPrompts()：只登记原始 variants
  → first resolve()：base + optional append → cache.set()
  → later resolve()：cache.get() → O(1)

register() again
  → clear composed cache
  → next resolve() rebuilds with latest source`} />
        <ComparisonTable
          headers={["阶段", "是否合成", "缓存状态"]}
          rows={[
            ["register", "否，只保存语言版和模型追加", "清空旧合成结果"],
            ["首次 resolve", "是", "写入 (key, provider, model)"],
            ["后续 resolve", "否", "直接命中 Map"],
          ]}
        />
      </Section>

      <Section title="PromptKey 按职责分组">
        <ComparisonTable
          headers={["使用区域", "PromptKey"]}
          rows={[
            ["主对话与预测", <><code>BASE_SYSTEM</code> · <code>PREDICT_INTENT</code></>],
            ["质量与续写", <><code>ANALYZE_RESULT</code> · <code>EVALUATOR_ANALYZE</code> · <code>GUIDANCE_RETRY</code> · <code>EVALUATE_STUCK</code></>],
            ["历史压缩", <code>COMPRESS_SUMMARIZE</code>],
            ["Post-conversation 输入截断", <code>TRUNCATION_MARKER</code>],
            ["Context 编译", <><code>CONTEXT_TOPIC_CONSTRAINT</code> · <code>CONTEXT_DIFFICULTY_RULES</code> · <code>CONTEXT_MODEL_UPGRADE</code></>],
            ["Context 补充", <><code>CONTEXT_EVALUATOR_HINT</code> · <code>CONTEXT_ENV_INFO</code></>],
          ]}
        />
      </Section>

      <Section title="Registry 与输出安全的边界">
        <ComparisonTable
          headers={["职责", "归属"]}
          rows={[
            ["选择语言、追加模型优化、缓存合成结果", <Badge color="purple">Prompt Registry</Badge>],
            ["修复 LLM 输出中的孤立 Unicode 代理", <Badge color="blue">stream / server</Badge>],
            ["安全截取长输入", <Badge color="orange">substringWellFormed</Badge>],
          ]}
        />
        <Callout type="warn" title="不要改写合法文本">
          <code>String.toWellFormed()</code> 只修复非法代理字符；字面量 <code>\u</code>、路径和代码必须原样保留。
        </Callout>
      </Section>
    </div>
  );
}
