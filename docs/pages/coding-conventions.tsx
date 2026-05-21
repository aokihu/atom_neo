import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ── Core Principle ── */}
      <Section title="核心原则：少写代码，更多力量">
        <Callout type="tip" title="Less Code, More Power">
          <ul>
            <li>不要写不必要的注释。代码本身应该是自解释的。</li>
            <li>不要引入不必要的抽象层。如果只有一个实现，就不需要接口。</li>
            <li>删掉没用到的代码，不要留着"以备后用"。</li>
            <li>优先使用标准库，其次使用已安装的依赖，最后才考虑新增依赖。</li>
          </ul>
        </Callout>
      </Section>

      {/* ── TypeScript Strictness ── */}
      <Section title="TypeScript 严格性">
        <CodeBlock lang="typescript" code={`// ALWAYS use strict types. NEVER use \`any\` except for:
// 1. Third-party library interop where types are unavailable
// 2. Generic constraints where exact type doesn't matter (e.g., Pipeline<any, any>)
// 3. Explicit \`as any\` casts with a comment explaining why

// BAD
function process(data: any) { ... }

// GOOD
function process(data: unknown) {
  if (typeof data === 'object' && data !== null) { ... }
}

// ACCEPTABLE (with reason)
type Pipeline<I = any, O = any> = { ... }  // Element chain typing is intentionally weak`} />
        <Callout type="warn" title="any 使用限制">
          仅限三种场景：第三方库互操作、泛型约束（Pipeline&lt;any, any&gt;）、显式 as any 强制转换并附带注释说明。
        </Callout>
      </Section>

      {/* ── Convention Rules Table ── */}
      <Section title="编码规范速查表">
        <ComparisonTable
          headers={["规则", "描述", <><Badge color="blue">分类</Badge></>]}
          rows={[
            [<strong>TypeScript Strict</strong>, "禁用 any，优先 unknown；严格类型检查", <Badge color="red">强制</Badge>],
            [<strong>File Structure</strong>, "模块目录：index.ts / types.ts / name.ts / elements/", <Badge color="purple">结构</Badge>],
            [<strong>Import Order</strong>, "外部包 → @atom-neo 内部 → 相对路径；禁止跨包绝对路径别名", <Badge color="blue">规范</Badge>],
            [<strong>Error Handling</strong>, "Element 抛出 → Runner 捕获并 emit；HTTP 返回 JSON；Tool 返回 { ok, error }", <Badge color="red">强制</Badge>],
            [<strong>Async Patterns</strong>, "async/await 替代 .then()；禁止混用；禁止 callback 风格", <Badge color="blue">规范</Badge>],
            [<strong>Immutability</strong>, "readonly 字段；返回新对象，不修改输入", <Badge color="orange">推荐</Badge>],
            [<strong>No Classes Without Reason</strong>, "仅 private state / extends BaseElement / lifecycle 时用 class", <Badge color="blue">规范</Badge>],
            [<strong>Dependency Injection</strong>, "构造器注入，禁止 singleton/global", <Badge color="red">强制</Badge>],
            [<strong>Structured Logging</strong>, "logger.info/error + 结构化数据；禁止 console.log", <Badge color="red">强制</Badge>],
            [<strong>Type Imports</strong>, 'import type 用于纯类型导入', <Badge color="blue">规范</Badge>],
            [<strong>File Header</strong>, "每个 .ts 文件必须有 JSDoc 头部注释（≤5行）", <Badge color="red">强制</Badge>],
            [<strong>No Default Exports</strong>, "始终使用命名导出", <Badge color="red">强制</Badge>],
          ]}
        />
      </Section>

      {/* ── Error Handling ── */}
      <Section title="错误处理模式">
        <Callout type="warn" title="各层级错误处理策略">
          <ul>
            <li><strong>Pipeline Elements:</strong> 抛出错误，由 PipelineRunner 处理</li>
            <li><strong>PipelineRunner:</strong> 捕获 → emit "element.failed" 事件 → 重新抛出</li>
            <li><strong>HTTP handlers:</strong> 捕获 → 返回 4xx/5xx JSON</li>
            <li><strong>Tool execution:</strong> 捕获 → 返回 {`{ ok: false, error: message }`}</li>
          </ul>
        </Callout>
        <CodeBlock lang="typescript" code={`// BAD: silent catch
try { await doStuff(); } catch { }

// GOOD: always report
try {
  await doStuff();
} catch (error) {
  this.report("element.data", { error: errorMessage(error) });
  throw error;
}`} />
      </Section>

      {/* ── Async Patterns ── */}
      <Section title="异步模式">
        <CodeBlock lang="typescript" code={`// Prefer async/await over raw promises
// BAD
function getData() {
  return fetch(url).then(r => r.json());
}

// GOOD
async function getData() {
  const r = await fetch(url);
  return r.json();
}

// NEVER mix .then() with await in the same function
// NEVER use callback-style APIs; wrap in promises if needed`} />
      </Section>

      {/* ── Immutability ── */}
      <Section title="不可变性">
        <CodeBlock lang="typescript" code={`// TaskItem: use \`readonly\` for immutable fields
// PipelineContext: create new context, don't mutate
// FlowState: always return NEW object, never mutate input

// BAD
function process(input: State): State {
  input.mode = "new_mode";  // mutation!
  return input;
}

// GOOD
function process(input: State): State {
  return { ...input, mode: "new_mode" };
}`} />
      </Section>

      {/* ── Classes vs Functions ── */}
      <Section title="类 vs 函数">
        <ComparisonTable
          headers={["场景", "使用方式", "理由"]}
          rows={[
            ["需要 private state (#field)", <Badge color="purple">class</Badge>, "ES2022 私有字段"],
            ["扩展 BaseElement", <Badge color="purple">class</Badge>, "继承链要求"],
            ["服务带生命周期 (start/stop)", <Badge color="purple">class</Badge>, "状态管理"],
            ["纯数据转换", <Badge color="green">function</Badge>, "无状态"],
            ["工具函数", <Badge color="green">function</Badge>, "单一职责"],
            ["配置对象", <Badge color="green">object</Badge>, "数据载体"],
          ]}
        />
        <CodeBlock lang="typescript" code={`// BAD: unnecessary class
class StringFormatter {
  format(s: string) { return s.trim(); }
}

// GOOD: simple function
const format = (s: string) => s.trim();`} />
      </Section>

      {/* ── Dependency Injection ── */}
      <Section title="依赖注入">
        <CodeBlock lang="typescript" code={`// Injection via constructor parameters, NOT singletons or globals
// Elements receive dependencies explicitly:

// BAD
const runtime = getGlobalRuntime();

// GOOD
class MyElement {
  #runtime: Runtime;
  constructor(params: { runtime: Runtime }) {
    this.#runtime = params.runtime;
  }
}`} />
        <Callout type="info" title="依赖注入规则">
          构造器参数注入，严禁单例模式和全局变量。每个 Element 显式接收依赖。
        </Callout>
      </Section>

      {/* ── Enum vs Union ── */}
      <Section title="Enum vs Union Types">
        <ComparisonTable
          headers={["使用场景", "类型", "示例"]}
          rows={[
            ["RUNTIME 使用 (switch/case)", <Badge color="purple">Enum</Badge>, <code>PipelineResultType.Complete</code>],
            ["通信协议中序列化/反序列化", <Badge color="purple">Enum</Badge>, '枚举值在 wire protocol 中传输'],
            ["判别联合的 discriminant", <Badge color="purple">Enum</Badge>, <code>{`{ mode: FlowMode.X }`}</code>],
            ["TYPE-only（无运行时访问）", <Badge color="green">Union</Badge>, <code>type LogLevel = "debug" | "info"</code>],
            ["函数参数短字符串字面量", <Badge color="green">Union</Badge>, <code>{`direction: "in" | "out"`}</code>],
          ]}
        />
      </Section>

      {/* ── Monorepo Package Rules ── */}
      <Section title="Monorepo 包规则">
        <div className="arch-layers">
          <div className="arch-layer arch-layer-tui" style={{ borderLeftColor: "var(--color-gateway, #f59e0b)" }}>
            <div className="arch-layer__label">tui/</div>
            <div className="arch-layer__desc">可导入 shared/</div>
          </div>
          <div className="arch-layer arch-layer-gateway" style={{ borderLeftColor: "var(--color-core, #22c55e)" }}>
            <div className="arch-layer__label">gateway/</div>
            <div className="arch-layer__desc">可导入 shared/</div>
          </div>
          <div className="arch-layer arch-layer-core">
            <div className="arch-layer__label">core/</div>
            <div className="arch-layer__desc">可导入 shared/</div>
          </div>
          <div className="arch-layer" style={{ borderLeft: "4px solid var(--color-accent, #6366f1)", padding: "16px", borderRadius: "8px", background: "var(--color-surface, #1e1e2e)" }}>
            <div className="arch-layer__label">shared/</div>
            <div className="arch-layer__desc" style={{ marginTop: "4px", color: "var(--color-muted, #6b7280)", fontSize: "13px" }}>MUST NOT 导入 core/, gateway/, tui/</div>
          </div>
        </div>
        <Callout type="warn" title="循环依赖禁止">
          包之间严禁循环依赖。shared 为底层，所有上层包可引用 shared，但 shared 不得反向引用。
        </Callout>
      </Section>

      {/* ── File Structure ── */}
      <Section title="文件结构约定">
        <CodeBlock lang="text" code={`# Every module follows this structure:
module-name/
├── index.ts          # Barrel export ONLY — re-exports from other files
├── types.ts          # Type definitions specific to this module
├── <name>.ts         # Main implementation
└── elements/         # If module contains Elements
    ├── element-a.ts
    └── element-b.ts`} />
      </Section>

      {/* ── Import Convention ── */}
      <Section title="导入约定">
        <CodeBlock lang="typescript" code={`// External packages first
import { z } from "zod";
import { generateText } from "ai";

// Internal packages (shared)
import { BaseElement, PipelineRunner } from "@atom-neo/shared";

// Same package, relative
import { type MyTypes } from "./types";
import { helper } from "./helpers";

// NEVER use absolute path aliases across package boundaries.
// Each workspace package has its own tsconfig paths.`} />
      </Section>

      {/* ── Logging ── */}
      <Section title="结构化日志">
        <CodeBlock lang="typescript" code={`// Use structured logging via the shared log system:
logger.info("task.created", { taskId, sessionId });
logger.error("pipeline.failed", { taskId, error: errorMessage(e) });

// NEVER: console.log, console.error in production code
// EXCEPTION: test files may use console.log for debugging`} />
      </Section>

      {/* ── File Header ── */}
      <Section title="文件头部注释">
        <CodeBlock lang="typescript" code={`/**
 * Short description of what this file does.
 *
 * Additional detail if needed. Max 5 lines.
 */`} />
        <Callout type="info">
          每个 <code>.ts</code> 文件 <strong>必须</strong> 有 JSDoc 头部注释，最多 5 行。
        </Callout>
      </Section>
    </div>
  );
}
