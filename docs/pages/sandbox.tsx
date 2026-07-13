import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function SandboxPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={4} />

      {/* ── Isolation Rules ── */}
      <Section title="隔离规则">
        <Callout type="warn" title="安全边界">
          Agent 所有操作默认限定在 SANDBOX 目录内。访问外部目录需要用户授权（暂未实现）。
        </Callout>

        <ComparisonTable
          headers={["操作", "SANDBOX 内", "SANDBOX 外"]}
          rows={[
            ["读取", <><Badge color="green">允许</Badge> 直接执行</>, <><Badge color="red">需要授权</Badge> 用户确认</>],
            ["写入/改写", <><Badge color="green">允许</Badge> 直接执行</>, <><Badge color="red">需要授权</Badge> 用户确认</>],
            ["执行命令", <><Badge color="green">允许</Badge> 沙箱内执行</>, <><Badge color="red">需要授权</Badge> 用户确认</>],
          ]}
        />

        <Callout type="tip" title="路径校验">
          所有 Tool 操作的路径在 <code>sandboxPath()</code> 函数中校验，越界路径会被拒绝。
        </Callout>
        <Callout type="info" title="动态 Tool Guard">
          Tool 可以保持对 Agent 可见，同时在执行前检查动态策略。首个接入的是 <code>webfetch</code>：前置能力发现未完成时返回 <code>TOOL_GUARD_BLOCKED</code> 和下一步操作，不发起网络请求。
        </Callout>
      </Section>

      {/* ── Directory Structure ── */}
      <Section title="Sandbox 目录结构">
        <CodeBlock lang="text" code={`sandbox/
├── config.json              # 模型配置
├── .env                     # API Keys
├── AGENTS.md               # 项目开发指引
├── .atom/                   # Agent 运行时数据
│   ├── memory/
│   │   └── memory.db       # 正文、图谱和 FTS5 索引
│   └── compiled_prompts/   # 缓存提示词
└── ...                      # 用户项目文件`} />
      </Section>

      {/* ── .atom/ ── */}
      <Section title=".atom/ 运行时目录">
        <Callout type="info" title="首次启动自动创建">
          Agent 启动时自动创建 <code>.atom/</code> 目录，存放所有运行时数据。
          <strong>除 AGENTS.md 和 .env 外，所有 Agent 数据文件存储在 .atom/ 下。</strong>
        </Callout>

        <ComparisonTable
          headers={["文件", "用途"]}
          rows={[
            [<code>.atom/memory/memory.db</code>, "长期记忆数据库（正文、图谱、FTS5）"],
            [<code>.atom/compiled_prompts/</code>, "缓存的编译后提示词"],
          ]}
        />
      </Section>

      {/* ── AGENTS.md ── */}
      <Section title="AGENTS.md 项目指引">
        <Callout type="ok" title="启动检查">
          Agent 启动时检查 <code>SANDBOX/AGENTS.md</code>：存在则加载，不存在则从模板复制。
        </Callout>

        <CodeBlock lang="typescript" code={`import agentsMdTemplate from "@assets/prompts/agents_md_sample.md";

function initAgentsMd(sandboxPath: string): void {
  const path = \`\${sandboxPath}/AGENTS.md\`;
  if (!existsSync(path)) {
    Bun.write(path, agentsMdTemplate);
  }
}`} />
      </Section>

      {/* ── Init Sequence ── */}
      <Section title="启动顺序">
        <CodeBlock lang="typescript" code={`// src/main.ts
await loadEnv(args.sandbox);
await loadConfig(args.sandbox);
setSandbox(args.sandbox);          // 绑定沙箱
initAtomDir(args.sandbox);        // 创建 .atom/
initAgentsMd(args.sandbox);       // 检查/创建 AGENTS.md
await startCore({ ... });`} />

        <Callout type="tip" title="模板位置">
          <code>src/assets/prompts/agents_md_sample.md</code> — 通过 <code>@assets/</code> 别名静态导入
        </Callout>
      </Section>

      {/* ── Template ── */}
      <Section title="AGENTS.md 模板内容">
        <CodeBlock lang="markdown" code={`# 项目开发指引

## 代码规范
- 遵循 "Less code, more power" 原则
- 避免重复创建相似功能，复用已有代码
- 先思考后编写，禁止盲目编写

## 项目信息
<!-- 在此补充项目特定的开发指引 -->`} />
      </Section>
    </div>
  );
}
