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

createSearchMemoryTool(memory) // { query, limit? }
// Returns matching content as <Memory id="short-id" tags="...">.

createSaveMemoryTool(memory)     // { content, tags? }
createTraverseMemoryTool(memory) // { startId, maxSteps? }
createLinkMemoryTool(memory)     // { source, target, relation }
createForgetMemoryTool(memory)   // { id }
// forget_memory accepts only a full or unique short hexadecimal ID.
// When only content is known, call search_memory first to obtain the ID.
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

## 7. Schedule Tools (Hook 体系)

定时任务基于事件驱动的 Hook 体系，支持三种时间触发器和 Session 生命周期集成。

### 7.1 架构

```
schedule_* Tools → HookManager → ScheduleService (time triggers)
                → Bus 事件监听 (session/task triggers)
```

### 7.2 Hook 类型

```typescript
// src/packages/shared/src/types/hook.ts

type HookTrigger =
  | { type: "time:cron"; schedule: string }
  | { type: "time:delay"; delayMs: number }
  | { type: "time:interval"; intervalMs: number }
  | { type: "session:start" }
  | { type: "session:end" }
  | { type: "task:completed" }

type Hook = {
  readonly id: string;
  readonly name: string;
  scope: "session" | "global";
  sessionId?: string;
  trigger: HookTrigger;
  prompt: string;
  enabled: boolean;
  readonly createdAt: number;
  updatedAt: number;
  lastFiredAt?: number;
}
```

### 7.3 三种时间调度类型

| 类型 | 实现 | 参数 | 行为 |
|------|------|------|------|
| `cron` | `Bun.cron()` | `schedule` (cron 表达式) | 按 cron 重复执行 |
| `delay` | `setTimeout()` | `delayMs` (毫秒) | 一次性延时，执行后自动移除 |
| `interval` | `setInterval()` | `intervalMs` (毫秒) | 按间隔重复执行 |

### 7.4 Session 生命周期

| scope | 绑定 | 生命周期 | 清理 | 触发行为 |
|-------|------|----------|------|---------|
| `session` | 自动绑定当前 sessionId | session 关闭时自动注销 | `Session.Closed` BusEvent → HookManager auto-cancel | 投递到绑定的 session |
| `global` | 不绑定 | 服务生命周期 | 手动 cancel 或 shutdown 清理 | 投递到最近活跃 session；无活跃 session 时跳过，打印 warn 日志 |

### 7.5 HookManager

```typescript
// src/packages/core/src/hooks/hook-manager.ts

class HookManager {
  constructor(scheduleService, bus, taskQueue, persistPath, logger);

  create(def): Hook;    // time:* → ScheduleService, event:* → Bus 监听
  list(filter?): Hook[];
  update(id, changes): Hook;
  cancel(id): boolean;
  restore(): void;     // 从 JSON 恢复
  stop(): void;        // 清理所有
}
```

### 7.6 触发流程

```
time:* trigger fires
  → ScheduleService.#fire()
    → task.onFire() → HookManager.#fire(hook)
      → resolve sessionId:
          scope=session → hook.sessionId
          scope=global → lastActiveSessionId (null if no active session)
      → if null: skip, log warn
      → TaskQueue.enqueue() + Bus.Task.Enqueued emit
        → conversation pipeline → AI 回复

session 关闭
  → sessionStore.onClosed() → Bus.emit(Session.Closed)
    → HookManager: auto-cancel 该 session 所有 scope=session hooks
    → HookManager: fire 匹配 session:end trigger 的 hooks
```

### 7.7 内置工具（4个，保留原名）

| 工具名 | 权限 | 关键输入 | 说明 |
|--------|------|------|------|
| `schedule_create` | FULL | `{ type?, name, schedule?, delayMs?, intervalMs?, prompt, scope? }` | 创建定时任务，默认 scope=session |
| `schedule_list` | READ_ONLY | `{ enabled? }` | 列出所有定时任务 |
| `schedule_update` | FULL | `{ id, schedule?, delayMs?, intervalMs?, prompt?, enabled? }` | 更新定时任务 |
| `schedule_cancel` | FULL | `{ id }` | 取消定时任务 |

### 7.8 持久化

Hooks 持久化到 sandbox 下 `hooks.json`。ScheduleService 内部任务持久化到 `schedule-tasks.json`。两文件各自维护。

### 7.9 配置

```json
{
  "schedule": {
    "persistPath": "schedule-tasks.json"
  }
}
```

## 8. Permission Filtering

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

## 9. Adding a New Tool

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
