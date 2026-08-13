import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ── ToolDefinition Interface ── */}
      <Section title="ToolDefinition 接口">
        <CodeBlock lang="typescript" code={`// src/src/packages/shared/src/types/tool.ts

import type { z } from "zod";

export interface ToolDefinition {
  /** Unique name, used in transport tool configuration */
  name: string;

  /** Human-readable description, shown to LLM */
  description: string;

  /** Source category: builtin, plugin, or mcp */
  source: "builtin" | "plugin" | "mcp";

  /** Zod schema for tool input validation */
  inputSchema: z.ZodType<Record<string, unknown>>;

  /** Execute the tool. Returns structured result. */
  execute(args: unknown): Promise<ToolResult>;

  /** Optional: permission level required */
  permission?: PermissionLevel;

  /** Allow same-name multi-call batches in one model step. */
  allowSameToolBatch?: boolean;
}

export type ToolResult = {
  content?: unknown;    // The only result projected to the LLM
  metadata:
    | {
        ok: true;
        effect: "none" | "reference" | "evidence" | "state_changed";
        contextInjection?: ToolContextInjection;
      }
    | {
        ok: false;
        effect: "none";
        error: string;
      };
};

export enum PermissionLevel {
  READ_ONLY = 0,
  FILE_WRITE = 1,
  FULL = 2,
}`} />
        <Callout type="info" title="设计理念">
          Tool 是统一接口：文件系统、Memory、Bash、MCP 操作都通过同一 <code>execute(args) → ToolResult</code> 模式。
          <code>content</code> 是唯一面向 LLM 的结果；<code>metadata</code> 只保存运行框架实际消费的
          <code>ok/effect/error/contextInjection</code>。只有 reference、evidence 或 state_changed
          才投影到当前手工循环，跨轮 Context 必须显式使用 contextInjection。
          MCP 成功结果在当前 conversation 中按 reference evidence 可用；空结果和错误由框架消费，
          不进入模型消息。
        </Callout>
      </Section>

      {/* ── Builtin Tools ── */}
      <Section title="内置工具">
        <ComparisonTable
          headers={["Tool", <><Badge color="blue">类别</Badge></>, <><Badge color="orange">权限</Badge></>, "描述"]}
          rows={[
            [<code>read</code>, "Filesystem", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "读取文件内容；支持 offset/limit"],
            [<code>write</code>, "Filesystem", <Badge color="orange">{`FILE_WRITE (1)`}</Badge>, "写入/覆盖文件"],
            [<code>ls</code>, "Filesystem", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "列出目录内容"],
            [<code>grep</code>, "Filesystem", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "基于正则搜索文件内容"],
            [<code>tree</code>, "Filesystem", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "目录树结构"],
            [<code>cp</code>, "Filesystem", <Badge color="orange">{`FILE_WRITE (1)`}</Badge>, "复制文件"],
            [<code>mv</code>, "Filesystem", <Badge color="orange">{`FILE_WRITE (1)`}</Badge>, "移动/重命名文件"],
            [<code>search_memory</code>, "Memory", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "按关键词搜索并返回摘要与短 ID"],
            [<code>read_memory</code>, "Memory", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "读取完整正文并返回 relatedCount"],
            [<code>save_memory</code>, "Memory", <Badge color="orange">{`FILE_WRITE (1)`}</Badge>, "保存新节点，可原子替代旧记忆"],
            [<code>traverse_memory</code>, "Memory", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "双向图遍历，返回摘要、关系与方向"],
            [<code>link_memory</code>, "Memory", <Badge color="orange">{`FILE_WRITE (1)`}</Badge>, "在两个记忆节点间建立关系"],
            [<code>forget_memory</code>, "Memory", <Badge color="orange">{`FILE_WRITE (1)`}</Badge>, "按完整或唯一短 ID 删除记忆"],
            [<code>recall_memory</code>, "Memory", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "按 session 召回上下文化记忆"],
            [<code>search_history</code>, "Session History", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "搜索当前 Session 已归档的原始消息"],
            [<code>read_history</code>, "Session History", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "按归档 ID 和消息序号读取原始消息"],
            [<code>bash</code>, <><Badge color="red">Shell</Badge> <Badge color="red">需确认</Badge></>, <Badge color="red">{`FULL (2)`}</Badge>, "在沙箱中执行 shell 命令"],
          ]}
        />
        <Callout type="info" title="Tool 自主选择">
          所有 Tool 始终开放，由 LLM 决定调用顺序。ToolGuard 只处理安全边界，不为 WebFetch
          增加 Memory 或 Skill 业务前置条件；本地优先顺序由 Prompt 要求 LLM 遵守。
        </Callout>
      </Section>

      {/* ── Builtin Tool Template ── */}
      <Section title="内置工具模板">
        <CodeBlock lang="typescript" code={`/**
 * <ToolName> — short description.
 *
 * source: builtin | plugin | mcp
 * permission: 0 | 1 | 2
 */
import type { ToolDefinition, ToolResult } from "@atom-neo/shared/types/tool";
import { PermissionLevel } from "@atom-neo/shared/types/tool";
import { z } from "zod";

const inputSchema = z.object({
  field1: z.string().describe("Description for LLM"),
  field2: z.number().optional().default(10),
});

async function execute(args: unknown): Promise<ToolResult> {
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      metadata: {
        ok: false,
        effect: "none",
        error: \`Invalid input: \${parsed.error.message}\`,
      },
    };
  }

  const { field1, field2 } = parsed.data;

  try {
    const result = \`Processed \${field1} with limit \${field2}\`;

    return {
      content: { message: result, field1, field2 },
      metadata: { ok: true, effect: "evidence" },
    };
  } catch (error) {
    return {
      metadata: {
        ok: false,
        effect: "none",
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export const myTool: ToolDefinition = {
  name: "my_tool",
  description: "Does something useful. Provide field1 to specify what to do.",
  source: "builtin",
  inputSchema,
  execute,
  permission: PermissionLevel.READ_ONLY,
};`} />
      </Section>

      <Section title="Session 历史工具">
        <CodeBlock lang="typescript" code={`search_history({
  query: string,
  role?: "user" | "assistant",
  limit?: number,       // default 5, max 20
})

read_history({
  archiveId: "message-000001" | "message-latest",
  fromSeq?: number,
  toSeq?: number,
  offset?: number,      // cursor returned by the previous read
  checkpointRevision?: number,
  limit?: number,       // default 20, max 50
})`} />
        <Callout type="info" title="只访问当前 Session">
          压缩后的原始消息保存在不可变 JSONL 分段中。Snapshot 只注入累计摘要和归档索引；
          Agent 需要核对原文时先调用 <code>search_history</code>，再用 <code>read_history</code> 精确读取。
          两个工具都由运行时绑定当前 Session，不接收物理文件路径，也不会把结果写回持久 Context。
          请求范围尚未读完时会附带可见的 <code>history_cursor</code>：多条消息按序号翻页，
          单条长消息按 offset 分段读取；offset 必须与精确 fromSeq 一起提交，并始终保留原始读取范围。<code>message-latest</code>
          搜索结果和游标都会锁定 checkpoint revision；首次读取也必须精确命中 fromSeq。
          latest 变化或 offset 已到非空消息末尾时明确要求重新检索，不会静默跳过原文。
        </Callout>
      </Section>

      {/* ── Tool Registry ── */}
      <Section title="Tool Registry">
        <ComparisonTable
          headers={["方法", "签名", "说明"]}
          rows={[
            [<code>register</code>, <code>{`(tool: ToolDefinition) => void`}</code>, "注册工具；重名抛出异常"],
            [<code>get</code>, <code>{`(name: string) => ToolDefinition`}</code>, "按名称获取；未找到抛出异常"],
            [<code>getAll</code>, <code>{`() => ToolDefinition[]`}</code>, "返回所有已注册工具"],
            [<code>buildTransportTools</code>, <code>{`() => Record<string, unknown>`}</code>, "构建 AI SDK transport 工具集"],
          ]}
        />
        <CodeBlock lang="typescript" code={`// src/packages/core/src/tools/registry.ts

export class ToolRegistry {
  #tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.#tools.has(tool.name)) {
      throw new Error(\`Tool "\${tool.name}" already registered\`);
    }
    this.#tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(\`Tool "\${name}" not found\`);
    return tool;
  }

  getAll(): ToolDefinition[] {
    return [...this.#tools.values()];
  }

  /** Build toolset for AI SDK transport */
  buildTransportTools(): Record<string, unknown> {
    const tools: Record<string, unknown> = {};
    for (const tool of this.#tools.values()) {
      tools[tool.name] = {
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: tool.execute,
      };
    }
    return tools;
  }
}`} />
      </Section>

      <Section title="通用 Tool 调用治理">
        <Callout type="info" title="不重复注入 Tool Catalog">
          Atom 只把当前 step 可用的 schema 交给 AI SDK，执行器保留在框架。
          <code>ToolCallLedger</code> 只治理执行，不复制 Tool description 或 input schema。
        </Callout>
        <CodeBlock lang="text" code={`全部 Tool → AI SDK tools → 模型 Tool Call
                              ↓
                     ToolCallLedger.begin()
                       ├─ execute → 读取 metadata.effect
                       └─ blocked → 返回一句模型指令
                              ↓
               下一 step 省略 tools（需要收尾时）`} />
        <ComparisonTable
          headers={["规则", "第一阶段行为", "边界"]}
          rows={[
            ["工具可见性", "所有已注册 Tool 始终开放", "框架不做业务路由"],
            ["同名批次", "仅 allowSameToolBatch=true 可多调用", "按 Call 顺序执行，不并发"],
            ["非法多调用", "执行前整批拒绝", "混合 Tool 或默认单次 Tool 均不部分执行"],
            ["相同调用", "同一进展窗口内只执行一次", "不同 Tool 成功后允许重新读取变化资源"],
            ["无进展", "只提示 LLM 重新判断", "不会隐藏 Tool 或强制收尾"],
            ["调用预算", "真实执行次数最多为本次 maxSteps", "手工 Tool Loop 同时限制模型 step"],
            ["循环收尾", "下一 step 省略 tools", "不发送 provider-specific toolChoice"],
            ["WebFetch 节流", "NetworkService：普通域名 1 秒；搜索引擎主域 5 秒", "跨 Task、Session 和查询 URL 生效"],
          ]}
        />
        <Callout type="info" title="显式 opt-in，不看权限猜测">
          <code>READ_ONLY</code> 不等于可批量：<code>intent</code>、<code>todowrite</code> 和 Skill
          状态工具也可能改变控制状态。MCP/插件 Tool 缺少 Atom 批量元数据时默认单次；支持 POST 的
          <code>webfetch</code> 同样默认单次。
        </Callout>
        <Callout type="warn" title="HTTP 成功不等于证据">
          WebFetch 会在适配层检查正文并按当前查询抽取相关片段。HTTP 成功但正文为空或不相关时返回
          <code>effect:none</code>，不会投影到模型 Context。
        </Callout>
        <Callout type="info" title="WebFetch 域名冷却">
          WebFetch Tool 只负责调用同进程 <code>NetworkService</code>。同一搜索引擎主域的请求起始时间至少间隔 5 秒，普通域名至少间隔 1 秒。HTTP 429
          优先采用更长的 <code>Retry-After</code>，否则默认冷却 60 秒；冷却期间直接返回
          <code>WEBFETCH_DOMAIN_COOLDOWN</code>，不会继续访问目标站点。并发调用会依次预留时间槽，
          等待服从 Task 取消；节流状态保存在当前进程内，重启后清空，并通过
          调度与冷却信息由 NetworkService 自己记录，不复制到通用 ToolResult。未来 download 或 stream 必须复用同一调度器，本阶段不创建占位实现。
        </Callout>
        <Callout type="info" title="本地证据顺序由模型执行">
          Prompt 要求 LLM 在 WebFetch 前先查询 Memory 与 Skill；框架不维护
          前置状态、不收窄 activeTools，也不使用 provider-specific toolChoice 强制 Tool。
        </Callout>
        <Callout type="info" title="HTML 证据片段">
          WebFetch 使用当前任务查询从 HTML 正文中抽取相关片段；只有片段 content 提供给模型。
          相关词覆盖不足时返回 <code>effect:none</code>；匹配过程不复制进 ToolResult。
        </Callout>
      </Section>

      {/* ── MCP Tool Adapter ── */}
      <Section title="MCP 工具适配器">
        <CodeBlock lang="typescript" code={`// src/packages/core/src/tools/adapters/mcp-tool.ts

export class MCPToolAdapter implements ToolDefinition {
  name: string;
  description: string;
  source = "mcp" as const;
  inputSchema: z.ZodSchema;

  #transport: MCPTransport;

  constructor(mcpTool: MCPToolSchema, transport: MCPTransport) {
    this.name = mcpTool.name;
    this.description = mcpTool.description;
    this.inputSchema = convertJSONSchemaToZod(mcpTool.inputSchema);
    this.#transport = transport;
  }

  async execute(args: unknown): Promise<ToolResult> {
    return this.#transport.callTool(this.name, args);
  }
}`} />
        <Callout type="info" title="适配器模式">
          MCP 工具通过 <code>MCPToolAdapter</code> 适配为统一的 <code>ToolDefinition</code> 接口，无缝集成到 ToolRegistry。
        </Callout>
      </Section>

      {/* ── Permission Filtering ── */}
      <Section title="权限过滤">
        <CodeBlock lang="typescript" code={`// src/packages/core/src/tools/permissions.ts

export function filterToolsByPermission(
  tools: ToolDefinition[],
  level: PermissionLevel,
): ToolDefinition[] {
  return tools.filter(tool => {
    const required = tool.permission ?? PermissionLevel.READ_ONLY;
    if (level < required) {
      return false;
    }
    // Bash requires explicit approval at FULL level
    if (tool.name === "bash" && tool.requiresApproval
        && level >= PermissionLevel.FULL) {
      return true;  // Still included but flagged for approval
    }
    return true;
  });
}`} />
      </Section>

      {/* ── Bash Tool ── */}
      <Section title="Bash 工具（特殊处理）">
        <Callout type="warn" title="Bash 需要用户审批">
          Bash 是唯一需要显式用户审批的工具。在 <code>PermissionLevel.FULL</code> 下，先检查 <code>context.approved</code> 标志。
        </Callout>
        <CodeBlock lang="typescript" code={`export const bashTool: ToolDefinition = {
  name: "bash",
  description:
    "Execute a shell command. Runs in sandboxed workspace directory.",
  source: "builtin",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
    timeout: z.number().optional().default(30000).describe("Timeout in ms"),
  }),
  execute: async (args, context?: { approved?: boolean }) => {
    if (!context?.approved) {
      return {
        ok: false,
        output: "",
        error: "Bash command requires user approval",
        metadata: { requiresApproval: true },
      };
    }
    // Execute command...
  },
  permission: PermissionLevel.FULL,
  requiresApproval: true,
};`} />
      </Section>

      {/* ── Tool Registration Flow ── */}
      <Section title="工具注册流程">
        <div className="cmp" style={{ display: "flex", gap: "8px", flexDirection: "column" }}>
          {[
            { step: "1", title: "创建文件", desc: <code>src/packages/core/src/tools/builtin/{'<name>'}.ts</code>, color: "blue" },
            { step: "2", title: "实现 ToolDefinition", desc: "name, description, inputSchema, execute, permission", color: "purple" },
            { step: "3", title: "命名导出", desc: "export const myTool: ToolDefinition = {...}", color: "purple" },
            { step: "4", title: "注册引导", desc: "在 tools/bootstrap.ts 中调用 registry.register(myTool)", color: "green" },
            { step: "5", title: "编写测试", desc: "测试 execute 的 ok/error 分支和输入校验", color: "orange" },
          ].map((s, idx, arr) => (
            <div key={s.step} style={{ display: "flex", alignItems: "stretch", gap: "0" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "40px" }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: `var(--color-${s.color}, #6366f1)`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "14px" }}>{s.step}</div>
                {idx < arr.length - 1 && <div style={{ width: "2px", flex: 1, background: "var(--color-border, #334155)", minHeight: "24px" }} />}
              </div>
              <div style={{ padding: "8px 12px 16px 12px" }}>
                <div style={{ fontWeight: 600, fontSize: "14px" }}>{s.title}</div>
                <div style={{ fontSize: "13px", color: "var(--color-muted, #6b7280)", marginTop: "4px" }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── File System Tools ── */}
      <Section title="文件系统工具示例">
        <CodeBlock lang="typescript" code={`// src/packages/core/src/tools/builtin/fs.ts

import { readFile } from "node:fs/promises";
import { PermissionLevel } from "@atom-neo/shared/types";

export const readTool: ToolDefinition = {
  name: "read",
  description: "Read the contents of a file. Provide the file path.",
  source: "builtin",
  inputSchema: z.object({
    filepath: z.string().describe("Absolute or relative path to the file"),
    offset: z.number().optional().describe("Line number to start from"),
    limit: z.number().optional().describe("Maximum lines to read"),
  }),
  execute: async (args) => {
    const { filepath, offset, limit } = readInputSchema.parse(args);
    try {
      const content = await readFile(filepath, "utf-8");
      const lines = content.split("\\n");
      const start = (offset ?? 1) - 1;
      const end = limit ? start + limit : undefined;
      const result = lines.slice(start, end).join("\\n");
      return {
        ok: true,
        output: result || "(empty file)",
        data: { filepath, lineCount: lines.length },
      };
    } catch (error) {
      return {
        ok: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  permission: PermissionLevel.READ_ONLY,
};`} />
      </Section>
    </div>
  );
}
