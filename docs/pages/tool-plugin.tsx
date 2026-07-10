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
}

export type ToolResult = {
  ok: boolean;
  output: string;       // Text result for LLM context
  error?: string;       // Error message if not ok
  data?: unknown;       // Structured data for downstream use
  metadata?: {
    tokensUsed?: number;
    durationMs?: number;
  };
};

export enum PermissionLevel {
  READ_ONLY = 0,
  FILE_WRITE = 1,
  FULL = 2,
}`} />
        <Callout type="info" title="设计理念">
          Tool 是统一接口：文件系统、Memory、Bash、MCP 操作都通过同一 <code>execute(args) → ToolResult</code> 模式。
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
            [<code>search_memory</code>, "Memory", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "按关键词搜索记忆图"],
            [<code>save_memory</code>, "Memory", <Badge color="orange">{`FILE_WRITE (1)`}</Badge>, "保存新记忆节点"],
            [<code>traverse_memory</code>, "Memory", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "图遍历检索记忆"],
            [<code>link_memory</code>, "Memory", <Badge color="orange">{`FILE_WRITE (1)`}</Badge>, "在两个记忆节点间建立关系"],
            [<code>forget_memory</code>, "Memory", <Badge color="orange">{`FILE_WRITE (1)`}</Badge>, "删除指定记忆节点"],
            [<code>recall_memory</code>, "Memory", <Badge color="blue">{`READ_ONLY (0)`}</Badge>, "按 session 召回上下文化记忆"],
            [<code>bash</code>, <><Badge color="red">Shell</Badge> <Badge color="red">需确认</Badge></>, <Badge color="red">{`FULL (2)`}</Badge>, "在沙箱中执行 shell 命令"],
          ]}
        />
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
      ok: false,
      output: "",
      error: \`Invalid input: \${parsed.error.message}\`,
    };
  }

  const { field1, field2 } = parsed.data;

  try {
    const result = \`Processed \${field1} with limit \${field2}\`;

    return {
      ok: true,
      output: result,
      data: { field1, field2 },
    };
  } catch (error) {
    return {
      ok: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
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
