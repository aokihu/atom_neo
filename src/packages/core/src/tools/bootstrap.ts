import { ToolRegistry } from "./registry";
import type { NetworkServiceLike, ToolDefinition } from "@atom-neo/shared";
import {
  createReadTool, createWriteTool, createLsTool, createTreeTool,
  createGrepTool, createCpTool, createMvTool, createGlobTool, createEditTool, createSandbox,
} from "./builtin/fs";
import { createBashTool } from "./builtin/bash";
import { createWebFetchTool } from "./builtin/webfetch";
import {
  createSearchMemoryTool, createReadMemoryTool, createSaveMemoryTool,
  createTraverseMemoryTool, createLinkMemoryTool, createForgetMemoryTool,
} from "./builtin/memory";
import { createIntentTool } from "./builtin/intent";
import { createTodoWriteTool } from "./builtin/todowrite";
import { createHistoryTools } from "./builtin/history";
import type { SessionPersistenceService } from "../session/persistence-service";
import { createToolGuard } from "./guard";

/** Create all builtin tool definitions (fs, bash, memory) for a sandbox. */
export function createAllTools(
  params: {
    sandbox: string;
    network: NetworkServiceLike;
    memory?: any;
    whitelist?: string[];
    persistence?: SessionPersistenceService;
  },
): ToolDefinition[] {
  const { sandbox, network, memory, whitelist, persistence } = params;
  const sb = createSandbox(sandbox);
  const raw: ToolDefinition[] = [
    createReadTool(sb), createWriteTool(sb), createLsTool(sb),
    createTreeTool(sb), createGrepTool(sb), createCpTool(sb), createMvTool(sb),
    createBashTool(sandbox),
    createSearchMemoryTool(memory as any),
    createReadMemoryTool(memory as any),
    createSaveMemoryTool(memory as any),
    createTraverseMemoryTool(memory as any),
    createLinkMemoryTool(memory as any),
    createForgetMemoryTool(memory as any),
    createIntentTool(),
    createTodoWriteTool(),
    createWebFetchTool(network),
    createGlobTool(sb), createEditTool(sb),
    ...(persistence ? createHistoryTools(persistence) : []),
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
  },
): void {
  for (const t of createAllTools(params)) {
    registry.register(t);
  }
}
