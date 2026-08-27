# Tool Plugin Specification

> **Purpose**: How to create, register, and execute Tool plugins.
> Tools are the unified interface for File System, Memory, Shell, and MCP operations.
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

  /** Explicitly allow multiple calls with this same tool name in one model step. */
  allowSameToolBatch?: boolean;

  /** Exclude framework/introspection tools from persistent ToolRecord history. */
  recordPolicy?: "record" | "exclude";
}

export type ToolResult = {
  content?: unknown; // The only result projected to the LLM
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
        errorSource: "guard" | "runtime" | "tool";
      };
};

export enum PermissionLevel {
  READ_ONLY = 0,
  FILE_WRITE = 1,
  FULL = 2,
}
```

`ToolExecuteOptions` 由运行时注入当前 `abortSignal`、`sessionId`、`taskId` 与 `chatId`。
`shell` 使用取消信号绑定当前 Task；`background_shell` 只使用 Task 身份创建完成通知，后台进程
不继承当前 Task 的取消信号。

## 2. Builtin Tool Template

`recordPolicy` 默认是 `record`。`request_tool_record` 与 `request_tool_records` 显式设置为
`exclude`：它们仍返回标准 Tool Result 供当前模型 step 使用，但不会记录自身，也不会占用当前
Conversation ToolsGroup 的 Step。是否记录失败由结构化 `errorSource` 决定，不按错误文本匹配。

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
      metadata: {
        ok: false,
        effect: "none",
        error: `Invalid input: ${parsed.error.message}`,
      },
    };
  }

  const { field1, field2 } = parsed.data;

  try {
    // === Tool logic here ===
    const result = `Processed ${field1} with limit ${field2}`;

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
};
```

`content` 只保存 LLM 需要的结果；`metadata` 只保存框架消费的 `ok/effect/error/contextInjection`。
`effect:none` 与失败结果也会投影到当前 Conversation 的下一模型 step，但不自动写入
Topic/Session Context。
禁止通过解析 `content` 文本猜测 effect。MCP 原始结果在当前 conversation 的后续 steps 中按
`reference` 使用，不能自动持久化或单独作为 Post/Compact 的完成事实。

`allowSameToolBatch` 默认是 `false`，不能从 `PermissionLevel.READ_ONLY` 推断。只有确认无副作用、
多次调用之间不依赖前一次结果的查询 Tool 才显式设为 `true`。控制状态 Tool（例如 `intent`、
`todowrite`、Skill load/unload）、写入 Tool、支持 POST 的 `webfetch`，以及没有 Atom 元数据的
MCP/插件 Tool 每个模型 step 只能调用一次。

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
        ...(result ? { content: result } : {}),
        metadata: { ok: true, effect: result ? "evidence" : "none" },
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
  },
  permission: PermissionLevel.READ_ONLY,
};

// Similar pattern for: write, ls, grep, tree, cp, mv
```

## 4. Memory Tools

```typescript
// src/packages/core/src/tools/builtin/memory.ts

createSearchMemoryTool(memory) // { query, limit? } -> MemorySummary
createReadMemoryTool(memory)   // { id } -> Memory + relatedCount
// search_memory returns <MemorySummary>; read_memory returns <Memory>.

createSaveMemoryTool(memory)     // { content, summary?, tags?, supersedesId? }
createTraverseMemoryTool(memory) // { startId, maxSteps? } -> bidirectional MemorySummary[] + relation/direction metadata
createLinkMemoryTool(memory)     // { source, target, relation }
createForgetMemoryTool(memory)   // { id }
// forget_memory accepts only a full or unique short hexadecimal ID.
// When only content is known, call search_memory first to obtain the ID.
// Updating a fact uses supersedesId so node creation and replacement are atomic.
```

### Context → Memory → Web 调用顺序

- `search_memory`、`read_memory` 与 Skill 工具对所有 intent 可用。
- 所有 Tool schema 始终开放，框架不按发现状态隐藏 Memory、Skill、History、MCP 或 WebFetch。
- Prediction 不生成 Memory query，也不自动搜索 Memory。
- Memory、Skill、History、MCP 与 WebFetch 的调用顺序和结果相关性全部由 Agent 判断。
- Prompt 要求 Agent 在 WebFetch 前先查询 Memory 与 Skill；ToolGuard 不添加对应业务前置条件。
- `traverse_memory` 同样只返回摘要和短 ID，不能绕过 `read_memory` 获取正文。
- 遍历摘要保留在当前 Conversation，但不写入 Session Tool Context。
- `skill_load` / `skill_section` 用 `state_changed` 通知框架刷新 Skill Context。
- Agent 可以自主扩大 Memory 查询；MCP 与其他非 WebFetch 工具不参与门控。

### 同名 Tool 批次

```text
允许: search_memory(query=A) + search_memory(query=B)
拒绝: search_memory(query=A) + ls(path=".")
拒绝: write(file=A) + write(file=B)
```

- 一个 step 有多个 Call 时，所有 `toolName` 必须相同，且该 Tool 必须设置
  `allowSameToolBatch: true`。
- Runtime 在执行任何 Call 前验证整个批次。非法批次不执行任何 executor，并为每个
  `call_id` 返回 `TOOL_BATCH_BLOCKED` 失败结果。
- 合法批次不是并发执行：Atom 按模型返回顺序逐个 `await`，收齐结果后再进入下一 step。

## 5. Session History Tools

历史消息被压缩后保存在当前 Session 目录的不可变 JSONL 分段中。Snapshot 只包含累计摘要和
归档索引；Agent 需要核对准确原文时使用专用只读工具，不能接收或暴露物理文件路径。

```typescript
search_history({
  query: string,
  role?: "user" | "assistant",
  limit?: number,       // default 5, max 20
})

read_history({
  archiveId: "message-000001" | "message-latest",
  fromSeq?: number,
  toSeq?: number,
  offset?: number,      // 长消息续读的 UTF-16 offset
  checkpointRevision?: number,
  limit?: number,       // default 20, max 50
})
```

规则：

- Session ID 来自当前 Tool 执行环境，参数中不接受 `sessionId`。
- `archiveId` 使用严格格式校验，不接受路径。
- 默认跳过 `visible === false` 的内部消息。
- 搜索使用普通文本匹配；首版不引入倒排索引。
- 返回结果同时受消息数量和字符数限制；只要范围中仍有未返回内容，就在文本中提供可直接用于下一次调用的 `history_cursor`。
- 游标保留原始 `toSeq` 和每页 `limit`。`offset` 只能与精确 `fromSeq` 一起使用；多条短消息按 `fromSeq` 翻页，单条长消息按 UTF-16 `offset` 续读，直到完整还原请求范围；非空消息不能从内容末尾继续读取。
- `search_history` 对 `message-latest` 命中同时返回 `checkpointRevision`，首次读取即可锁定检查点。`read_history` 还会要求显式 `fromSeq` 必须精确命中首条消息；latest 变化、anchor 消失、offset 越界或切入代理对时返回明确错误，禁止静默跳消息。
- 搜索同时命中不可变分段与 latest 时优先返回不可变 `message-{n}` 引用。
- 工具结果只供当前 step 使用，不写入长期 Session Tool Context。
- 普通 Tool Result 只写结构化 Session 审计；跨轮 Context 仅接受显式 `contextInjection`。
- `search_history` 和 `read_history` 对所有 intent 可见，不参与 Memory/Skill/Web 门控。

通用 `read` / `shell` 仍不用于读取 `.atom` 内部状态；History Tool 通过
`SessionPersistenceService` 的受限接口访问当前 Session。

## 6. Tool Registry

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

## 7. MCP Tool Integration

MCP tools are integrated via `@ai-sdk/mcp` package. The client auto-converts MCP tools to AI SDK tool format — no adapter class needed.

### 7.1 Config Schema

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

### 7.2 MCP Client Manager

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

### 7.3 TUI Sidebar — MCP Tools Block

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

### 7.4 MCP Health Check

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

### 7.5 Status Broadcasting

Status changes are broadcast to TUI via WebSocket:

```
MCPToolStatus = "event.mcp.tool.status"
payload: { servers: { name, online, toolNames }[] }
```

TUI WS client receives the event and updates `toolInfos` in App state, which flows to Sidebar.

### 7.6 Data Flow

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

### 7.7 Tool Pipeline Merge

MCP tools (AI SDK format) are merged directly with builtin tools before `streamText()`:

```
createAllTools() ──> ToolDefinition[] ──> buildAllAiTools() ──┐
                                                              ├──> { ...builtin, ...mcp } ──> streamText()
mcpClient.tools() ────────────> AI-SDK tools ───────────────┘
```

MCP tool execution is wrapped with step-counting and event reporting, identical to builtin tools.

### 7.8 通用 Tool 调用治理

Builtin 与可执行 MCP Tool 共用同一个、仅在本次 `streamText()` 生命周期内有效的
`ToolCallLedger`。治理层位于 AI SDK Tool 的 `execute` 包装层，不修改 Tool Schema，
也不向 System Prompt 注入额外 Tool Catalog。

```
全部已注册 Tool ──> AI SDK tools ──> 模型选择 Tool
                                      │
                                      ▼
                              ToolCallLedger.begin()
                                │              │
                             execute         blocked
                                │              │
                                ▼              ▼
                              Tool Result + 治理日志
                                      │
                                      ▼
                    下一 step 不提供 tools（需要收尾时）
```

规则：

- 所有已注册 Tool 在每个普通步骤中保持可见。
- `intent` 是 Pipeline 终结信号，不进入执行治理；没有本地 `execute` 的 Provider Tool 也不进入 Ledger。
- `toolName + 规范化参数` 生成不可逆短指纹，日志不记录完整参数；同一进展窗口内的相同指纹只真实执行一次。
- 一个不同 Tool 调用成功后开始新的进展窗口，因此允许重新读取已经被其他成功操作改变的资源。
- Ledger 根据 `metadata.effect !== "none"` 提供进展参考；失败和无结果只增加无进展计数。
- 连续无进展只向 LLM 提示重新判断，不停止或隐藏 Tool；完全重复调用会被拒绝，真实执行次数达到
  `maxSteps` 时才强制收尾。
- 停止状态不会发送 provider-specific `toolChoice`；下一 step 省略 tools，让模型使用已有结果生成最终文本。
- 治理拦截只返回模型需要的一句指令；原因和计数保留在框架日志中。

日志事件：

| `step` | 关键字段 | 用途 |
|---|---|---|
| `tool-governance-decision` | `decision`、`reason`、`fingerprint`、计数器 | 记录执行或拦截决定 |
| `tool-governance-result` | `ok`、`effect`、`stopReason`、计数器 | 记录执行后的治理状态 |
| `tool-governance-stop` | `stepNumber`、`stopReason`、计数器 | 解释为何下一 step 不再提供 tools |
| `done` | `toolAttempts`、`toolExecutions`、`toolBlocked`、`toolStopReason` | 汇总本轮治理结果 |

### 7.1 WebFetch 域名节流

WebFetch Tool 是 `NetworkService.webFetch()` 的薄适配器。唯一 NetworkService 实例维护
进程级域名节流状态，跨 Task、Session 和不同查询 URL 生效，避免 Agent 通过修改关键词
绕过调用间隔：

- 普通域名的请求起始时间至少间隔 1 秒。
- 搜索引擎同一主域的请求起始时间至少间隔 5 秒；`www.google.com` 与
  `news.google.com` 等子域共享同一个节流键。
- 同一域名的并发调用先预留下一个请求时间，再等待执行，因此不会在等待结束后同时放行。
- HTTP 429 会立即为该域名建立冷却；优先使用更长的 `Retry-After`，没有有效响应头时
  默认冷却 60 秒。
- 冷却期间的新调用直接返回 `WEBFETCH_DOMAIN_COOLDOWN`，不发起网络请求；Service 重启后
  内存中的冷却状态清空。
- 节流等待服从 Task 的 `AbortSignal`；域名、等待时间和冷却时间只写入 NetworkService 日志，
  不扩充通用 ToolResult。
页面质量分类、正文相似度和可用内容判定仍属于后续 WebFetch 专项治理；NetworkService
只控制真实请求节奏，不把 HTTP 2xx 自动提升为有效证据。未来 download 或 stream 必须
复用同一域名调度器，但本阶段不提供占位实现。

## 8. Schedule Tools (Hook 体系)

定时任务基于事件驱动的 Hook 体系，支持三种时间触发器和 Session 生命周期集成。

### 8.1 架构

```
schedule_* Tools → HookManager → ScheduleService (time triggers)
                → Bus 事件监听 (session/task triggers)
```

### 8.2 Hook 类型

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

`task:completed` Hook 的外部名称保持不变，但运行时监听的是 checkpoint 成功后的
`Task.Committed`，因此 Session 保存失败时不会触发 Hook。Hook 创建的 Task 带有 origin 标记；
它及其 continuation chain 不再触发 `task:completed` Hook，避免自递归。

### 8.3 三种时间调度类型

| 类型 | 实现 | 参数 | 行为 |
|------|------|------|------|
| `cron` | `Bun.cron()` | `schedule` (cron 表达式) | 按 cron 重复执行 |
| `delay` | `setTimeout()` | `delayMs` (毫秒) | 一次性延时，执行后自动移除 |
| `interval` | `setInterval()` | `intervalMs` (毫秒) | 按间隔重复执行 |

### 8.4 Session 生命周期

| scope | 绑定 | 生命周期 | 清理 | 触发行为 |
|-------|------|----------|------|---------|
| `session` | 自动绑定当前 sessionId | session 关闭时自动注销 | `Session.Closed` BusEvent → HookManager auto-cancel | 投递到绑定的 session |
| `global` | 不绑定 | 服务生命周期 | 手动 cancel 或 shutdown 清理 | 投递到最近活跃 session；无活跃 session 时跳过，打印 warn 日志 |

### 8.5 HookManager

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

### 8.6 触发流程

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

### 8.7 内置工具（4个，保留原名）

| 工具名 | 权限 | 关键输入 | 说明 |
|--------|------|------|------|
| `schedule_create` | FULL | `{ type?, name, schedule?, delayMs?, intervalMs?, prompt, scope? }` | 创建定时任务，默认 scope=session |
| `schedule_list` | READ_ONLY | `{ enabled? }` | 列出所有定时任务 |
| `schedule_update` | FULL | `{ id, schedule?, delayMs?, intervalMs?, prompt?, enabled? }` | 更新定时任务 |
| `schedule_cancel` | FULL | `{ id }` | 取消定时任务 |

### 8.8 持久化

Hooks 持久化到 sandbox 下 `hooks.json`。ScheduleService 内部任务持久化到 `schedule-tasks.json`。两文件各自维护。

### 8.9 配置

```json
{
  "schedule": {
    "persistPath": "schedule-tasks.json"
  }
}
```

## 9. Permission Filtering

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
    // Shell tools require explicit approval at FULL level
    if (["shell", "background_shell"].includes(tool.name)
        && tool.requiresApproval && level >= PermissionLevel.FULL) {
      return true;  // Still included but flagged for approval
    }
    return true;
  });
}
```

## 10. Adding a New Tool

```text
1. Create file: src/packages/core/src/tools/builtin/<name>.ts
2. Implement ToolDefinition interface
3. Export as named export
4. Register in tools/bootstrap.ts
5. Write tests
```

---

## Appendix: Shell Tools (Special Case)

```typescript
export const shellTool: ToolDefinition = {
  name: "shell",
  description: "Execute a shell command. The command is run in a sandboxed workspace directory.",
  source: "builtin",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
    timeout: z.number().optional().default(30000).describe("Timeout in ms"),
  }),
  execute: async (args, context) => executeForegroundShell(args, context),
  permission: PermissionLevel.FULL,
  requiresApproval: true,
};

export const backgroundShellTool: ToolDefinition = {
  name: "background_shell",
  description: "Start a long-running shell command and notify the agent when it exits.",
  source: "builtin",
  inputSchema: z.object({ command: z.string() }),
  execute: async (args, context) => backgroundShell.start(args, context),
  permission: PermissionLevel.FULL,
  requiresApproval: true,
};
```

两者复用同一套 `Bun.spawn(["sh", "-c", command])` 与有界输出收集。`shell` 等待完成并继承
当前 Task 的 `AbortSignal`；`background_shell` 立即返回 `jobId` 和 `pid`，使用
`Subprocess.exited` 在后台等待。命令成功或失败后均通过现有
`InternalTaskOrchestrator.scheduleConversation()` 创建独立的内部 Task。后台 Job 不调用
`unref()`，Core 关闭时由 Service 统一终止，因此不会产生无法回传完成状态的孤儿进程。

## 相关文档

| 文档 | 说明 |
|------|------|
| [sandbox.md](./sandbox.md) | ToolGuard 沙箱路径隔离规则 |
| [memory-service.md](./memory-service.md) | Memory 工具（search/save/traverse/link）的实现参考 |
| [session.md](../core/session.md) | SessionContext 中 toolContext 状态管理 |
