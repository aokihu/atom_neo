import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function NetworkServicePage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      <Section title="架构定位">
        <CodeBlock lang="text" code={`AI SDK Tool Call
  → Core webfetch Tool Adapter
  → NetworkServiceLike.webFetch()
  → NetworkService
      ├── DomainScheduler
      └── WebFetch
  → WebFetchResponse
  → ToolResult`} />
        <Callout type="info" title="同进程 Service">
          <code>NetworkService</code> 由应用层 <code>ServiceManager</code> 管理。Core 只依赖跨层接口，
          不持有 HTTP、域名队列或 429 冷却状态。
        </Callout>
      </Section>

      <Section title="职责边界">
        <ComparisonTable
          headers={["层", "负责", "不负责"]}
          rows={[
            [<Badge color="blue">Tool Adapter</Badge>, "名称、Schema、权限、ToolResult 映射", "HTTP、限速、正文处理"],
            [<Badge color="purple">Governance</Badge>, "前置条件、判重、预算、无进展停止", "网络并发与 429 冷却"],
            [<Badge color="green">NetworkService</Badge>, "生命周期、共享调度器、日志、子功能入口", "AI SDK 类型、Prompt、Agent 决策"],
            [<Badge color="orange">WebFetch</Badge>, "URL、HTTP、Timeout/Abort、HTML 提取", "搜索、下载、流式传输"],
          ]}
        />
      </Section>

      <Section title="公共契约">
        <CodeBlock lang="typescript" code={`interface NetworkServiceLike {
  webFetch(
    request: WebFetchRequest,
    options?: NetworkRequestOptions,
  ): Promise<WebFetchResponse>;
}`} />
        <p>跨层契约位于 <code>@atom-neo/shared</code>，不引用 AI SDK 的 <code>ToolResult</code>。</p>
      </Section>

      <Section title="WebFetch 调度规则">
        <ComparisonTable
          headers={["策略", "规则", "目的"]}
          rows={[
            ["普通域名", "请求起始时间至少间隔 1 秒", "避免瞬时突发"],
            ["搜索引擎", "同一主域至少间隔 5 秒，子域共享", "降低封禁风险"],
            ["并发调用", "预留时间槽后等待", "避免同时放行"],
            ["HTTP 429", "max(60 秒, Retry-After)", "遵循服务端冷却"],
            ["不同域名", "独立调度", "保留 AI SDK Tool 并行能力"],
            ["浏览器身份", "桌面或移动 Chrome/Safari UA 池随机选择", "改善基础内容协商"],
          ]}
        />
        <Callout type="warn" title="唯一调度器">
          未来的 download 或 stream 必须复用 NetworkService 的同一域名调度器，不能用独立状态绕过预算。
        </Callout>
      </Section>

      <Section title="浏览器请求身份">
        <p>
          Tool 只新增可选的 <code>isMobile</code>，不提供浏览器名称、版本或 User-Agent 专用参数。
          NetworkService 默认随机使用桌面 Chrome/Safari；移动模式随机使用移动 Chrome/Safari。
        </p>
        <Callout type="warn" title="不是完整浏览器">
          UA 模拟不包含 JavaScript、Cookie、TLS 指纹或 Client Hints，不能绕过登录墙、验证码或脚本渲染。
          调用方显式传入的 User-Agent Header 仍优先，以保持现有 Headers 能力兼容。
        </Callout>
      </Section>

      <Section title="生命周期与日志">
        <CodeBlock lang="text" code={`main.ts
  → register("network", new NetworkService())
  → await startAll()
  → startCore({ sm })
  → createWebFetchTool(network)`} />
        <p>日志只记录 feature、domain、排队/网络耗时、状态、响应字节数、冷却时间和结果码；不记录正文、敏感 Header 或完整查询参数。</p>
      </Section>

      <Section title="本阶段非目标">
        <ComparisonTable
          headers={["不实现", "处理方式"]}
          rows={[
            ["Worker / Worker Pool", "等待内容处理的性能证据"],
            ["download / stream / websearch", "不创建占位方法"],
            ["缓存、Proxy、Cookie、自动重试", "独立设计"],
            ["内容质量与 SSRF 新策略", "本次保持既有行为"],
          ]}
        />
      </Section>
    </div>
  );
}
