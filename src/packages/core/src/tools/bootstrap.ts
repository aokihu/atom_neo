import { ToolRegistry } from "./registry";
import type { NetworkServiceLike, ToolDefinition } from "@atom-neo/shared";
import {
  createReadTool, createWriteTool, createLsTool, createTreeTool,
  createGrepTool, createCpTool, createMvTool, createGlobTool, createEditTool, createSandbox,
} from "./builtin/fs";
import { createBackgroundShellTool, createShellTool } from "./builtin/shell";
import type { BackgroundShellService } from "./builtin/shell";
import { createWebFetchTool } from "./builtin/webfetch";
import { createWebSearchTool } from "./builtin/websearch";
import {
  createSearchMemoryTool, createReadMemoryTool, createSaveMemoryTool,
  createTraverseMemoryTool, createLinkMemoryTool, createForgetMemoryTool,
} from "./builtin/memory";
import { createIntentTool } from "./builtin/intent";
import { createTodoWriteTool } from "./builtin/todowrite";
import { createHistoryTools } from "./builtin/history";
import { createToolRecordTools } from "./builtin/tool-records";
import type { SessionPersistenceService } from "../session/persistence-service";
import { createToolGuard } from "./guard";

/** Create all builtin tool definitions (fs, shell, memory) for a sandbox. */
export function createAllTools(
  params: {
    sandbox: string;
    network: NetworkServiceLike;
    memory?: any;
    whitelist?: string[];
    persistence?: SessionPersistenceService;
    backgroundShell: BackgroundShellService;
  },
): ToolDefinition[] {
  const { sandbox, network, memory, whitelist, persistence, backgroundShell } = params;
  const sb = createSandbox(sandbox);
  const raw: ToolDefinition[] = [
    createReadTool(sb), createWriteTool(sb), createLsTool(sb),
    createTreeTool(sb), createGrepTool(sb), createCpTool(sb), createMvTool(sb),
    createShellTool(sandbox),
    createBackgroundShellTool(backgroundShell),
    createSearchMemoryTool(memory as any),
    createReadMemoryTool(memory as any),
    createSaveMemoryTool(memory as any),
    createTraverseMemoryTool(memory as any),
    createLinkMemoryTool(memory as any),
    createForgetMemoryTool(memory as any),
    createIntentTool(),
    createTodoWriteTool(),
    createWebFetchTool(network),
    createWebSearchTool(network),
    createGlobTool(sb), createEditTool(sb),
    ...(persistence ? createHistoryTools(persistence) : []),
    ...(persistence ? createToolRecordTools(persistence.toolRecords) : []),
  ];
  return raw.map(t => createToolGuard(t, sandbox, whitelist ?? []));
}

export function registerBuiltinTools(
  registry: ToolRegistry,
  params: {
    sandbox: string;
    network: NetworkServiceLike;
    whitelist?: string[];
    persistence?: SessionPersistenceService;
    backgroundShell: BackgroundShellService;
  },
): void {
  for (const t of createAllTools(params)) {
    registry.register(t);
  }
}
