# Tool Plugin Specification

> **Purpose**: How to create, register, and execute Tool plugins.
> Tools are the unified interface for File System, Memory, Bash, and MCP operations.
> **所有 Tool 操作默认限定在 SANDBOX 目录内**，路径越界将被拒绝。
> 详见 [sandbox.md](./sandbox.md)。

---

## 1. Tool Definition Interface

```typescript
// src/packages/shared/src/types/tool.ts

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
}
```

## 2. Builtin Tool Template

```typescript
/**
 * <ToolName> — short description.
 *
 * source: builtin | plugin | mcp
 * permission: 0 | 1 | 2
 */
import type { ToolDefinition, ToolResult } from "@atom-neo/shared/types/tool";
import { PermissionLevel } from "@atom-neo/shared/types/tool";
import { z } from "zod";

const inputSchema = z.object({
  // Define expected input fields
  field1: z.string().describe("Description for LLM"),
  field2: z.number().optional().default(10),
});

async function execute(args: unknown): Promise<ToolResult> {
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      output: "",
      error: `Invalid input: ${parsed.error.message}`,
    };
  }

  const { field1, field2 } = parsed.data;

  try {
    // === Tool logic here ===
    const result = `Processed ${field1} with limit ${field2}`;

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
};
```

## 3. File System Tools

```typescript
// src/packages/core/src/tools/builtin/fs.ts

// All file operations are sandboxed to config.sandboxPath.
// Paths that escape the sandbox are rejected.

import { readdir, stat } from "node:fs/promises";
import { PermissionLevel } from "@atom-neo/shared/types";

export const readTool: ToolDefinition = {
  name: "read",
  description: "Read the contents of a file. Provide the file path.",
  source: "builtin",
  inputSchema: z.object({
    filepath: z.string().describe("Absolute or relative path to the file"),
    offset: z.number().optional().describe("Line number to start reading from"),
    limit: z.number().optional().describe("Maximum number of lines to read"),
  }),
  execute: async (args) => {
    const { filepath, offset, limit } = readInputSchema.parse(args);
    try {
      const content = await Bun.file(filepath).text();
      const lines = content.split("\n");
      const start = (offset ?? 1) - 1;
      const end = limit ? start + limit : undefined;
      const result = lines.slice(start, end).join("\n");
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
};

// Similar pattern for: write, ls, grep, tree, cp, mv
```

## 4. Memory Tools

```typescript
// src/packages/core/src/tools/builtin/memory.ts

export const searchMemoryTool: ToolDefinition = {
  name: "search_memory",
  description: "Search memory by keywords. Returns matching facts, preferences, and constraints.",
  source: "builtin",
  inputSchema: z.object({
    query: z.string().describe("Search keywords or question"),
    scope: z.enum(["core", "short", "long"]).default("long"),
    limit: z.number().optional().default(10),
  }),
  execute: async (args) => {
    // Calls MemoryService
  },
  permission: PermissionLevel.READ_ONLY,
};

export const saveMemoryTool: ToolDefinition = { /* ... */ };
export const traverseMemoryTool: ToolDefinition = { /* ... */ };
export const linkMemoryTool: ToolDefinition = { /* ... */ };
```

## 5. Tool Registry

```typescript
// src/packages/core/src/tools/registry.ts

export class ToolRegistry {
  #tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" already registered`);
    }
    this.#tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
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
}
```

## 6. MCP Tool Integration

MCP tools are integrated via `@ai-sdk/mcp` package. The client auto-converts MCP tools to AI SDK tool format — no adapter class needed.

### 6.1 Config Schema

```json
{
  "mcpServers": [
    {
      "name": "weather",
      "transport": { "type": "http", "url": "http://localhost:3000/mcp" }
    },
    {
      "name": "filesystem",
      "transport": { "type": "stdio", "command": "node", "args": ["mcp-server.js"] }
    },
    {
      "name": "web-search",
      "transport": { "type": "sse", "url": "http://localhost:3000/sse" }
    }
  ]
}
```

### 6.2 MCP Client Manager

```typescript
// src/packages/core/src/tools/mcp-manager.ts

export type MCPServerConfig = {
  name: string;
  transport:
    | { type: "http"; url: string; headers?: Record<string, string> }
    | { type: "sse"; url: string; headers?: Record<string, string> }
    | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string };
};

export type MCPClient = Awaited<ReturnType<typeof createMCPClient>>;

// Initialize all MCP clients from config
export async function initMCPClients(configs: MCPServerConfig[]): Promise<MCPClient[]>

// Fetch and merge tools from all clients
export async function fetchMCPTools(clients: MCPClient[]): Promise<Record<string, any>>

// Close all MCP connections
export async function closeMCPClients(clients: MCPClient[]): Promise<void>
```

### 6.3 TUI Sidebar — MCP Tools Block

The TUI right sidebar displays MCP tools with live online/offline status and collapsible layout.

```
展开态:                              折叠态:
┌─ MCP Tools (5/7) ▲ ──┐            ┌─ MCP Tools (5/7) ▼ ──┐
│ ◆ context7           │            └───────────────────────┘
│ ◆ weather            │
│ ◇ filesystem         │   ← 灰色=离线
│ ◆ search             │
└──────────────────────┘
```

Status indicators:
- `◆` bright orange (`status.warning`) = online
- `◇` gray (`text.muted`) = offline

Click anywhere on the block to toggle expand/collapse.

### 6.4 MCP Health Check

Periodic health detection runs every 30 seconds:

```typescript
// src/packages/core/src/tools/mcp-manager.ts

export type MCPServerStatus = { name: string; online: boolean; toolNames: string[] };

export async function checkMCPHealth(
  clients: MCPClient[],
  configs: MCPServerConfig[],
): Promise<MCPServerStatus[]>

export function startMCPHealthCheck(
  clients: MCPClient[],
  configs: MCPServerConfig[],
  onStatusChange: (statuses: MCPServerStatus[]) => void,
): () => void  // returns stop function
```

Health check tries `client.listResources()` on each client. Success → online, failure → offline.

### 6.5 Status Broadcasting

Status changes are broadcast to TUI via WebSocket:

```
MCPToolStatus = "event.mcp.tool.status"
payload: { servers: { name, online, toolNames }[] }
```

TUI WS client receives the event and updates `toolInfos` in App state, which flows to Sidebar.

### 6.6 Data Flow

```
mcp-manager.ts                 server.ts                    WS → TUI
┌──────────────┐    ┌──────────────────────────┐    ┌──────────────────┐
│ initMCPClient │───>│ toolInfos (name+source+  │───>│ ServerInfo       │
│ fetchMCPTools │    │  online: true)           │    │   .toolInfos     │
│              │    │ startMCPHealthCheck()     │    │                  │
│              │    │   → onStatusChange()      │    │ MCPToolStatus    │
│              │    │     → broadcaster.send()  │───>│   → update online│
└──────────────┘    └──────────────────────────┘    └──────────────────┘
```

### 6.7 Tool Pipeline Merge

MCP tools (AI SDK format) are merged directly with builtin tools before `streamText()`:

```
createAllTools() ──> ToolDefinition[] ──> buildAllAiTools() ──┐
                                                              ├──> { ...builtin, ...mcp } ──> streamText()
mcpClient.tools() ────────────> AI-SDK tools ───────────────┘
```

MCP tool execution is wrapped with step-counting and event reporting, identical to builtin tools.

## 7. Permission Filtering

```typescript
// src/packages/core/src/tools/permissions.ts

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
    if (tool.name === "bash" && tool.requiresApproval && level >= PermissionLevel.FULL) {
      return true;  // Still included but flagged for approval
    }
    return true;
  });
}
```

## 8. Adding a New Tool

```text
1. Create file: src/packages/core/src/tools/builtin/<name>.ts
2. Implement ToolDefinition interface
3. Export as named export
4. Register in tools/bootstrap.ts
5. Write tests
```

---

## Appendix: Bash Tool (Special Case)

```typescript
// Bash is special because it requires user approval and runs in a shell.
export const bashTool: ToolDefinition = {
  name: "bash",
  description: "Execute a shell command. The command is run in a sandboxed workspace directory.",
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
  requiresApproval: true,  // flagged in UI
};
```

## 相关文档

| 文档 | 说明 |
|------|------|
| [sandbox.md](./sandbox.md) | ToolGuard 沙箱路径隔离规则 |
| [memory-service.md](./memory-service.md) | Memory 工具（search/save/traverse/link）的实现参考 |
| [session.md](../core/session.md) | SessionContext 中 toolContext 状态管理 |
