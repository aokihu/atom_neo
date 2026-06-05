import { ToolRegistry } from "./registry";
import type { ToolDefinition } from "@atom-neo/shared";
import {
  createReadTool, createWriteTool, createLsTool, createTreeTool,
  createGrepTool, createCpTool, createMvTool, createGlobTool, createEditTool, createSandbox,
} from "./builtin/fs";
import { createBashTool } from "./builtin/bash";
import { createWebFetchTool } from "./builtin/webfetch";
import {
  createSearchMemoryTool, createSaveMemoryTool,
  createTraverseMemoryTool, createLinkMemoryTool,
} from "./builtin/memory";
import { createIntentTool } from "./builtin/intent";
import { createToolGuard } from "./guard";

/** Create all builtin tool definitions (fs, bash, memory) for a sandbox. */
export function createAllTools(sandbox: string, memory?: any, whitelist?: string[]): ToolDefinition[] {
  const sb = createSandbox(sandbox);
  const raw: ToolDefinition[] = [
    createReadTool(sb), createWriteTool(sb), createLsTool(sb),
    createTreeTool(sb), createGrepTool(sb), createCpTool(sb), createMvTool(sb),
    createBashTool(sandbox),
    createSearchMemoryTool(memory as any),
    createSaveMemoryTool(memory as any),
    createTraverseMemoryTool(memory as any),
    createLinkMemoryTool(memory as any),
    createIntentTool(),
    createWebFetchTool(),
    createGlobTool(sb), createEditTool(sb),
  ];
  return raw.map(t => createToolGuard(t, sandbox, whitelist ?? []));
}

export function registerBuiltinTools(registry: ToolRegistry, sandbox: string, whitelist?: string[]): void {
  for (const t of createAllTools(sandbox, undefined, whitelist)) {
    registry.register(t);
  }
}
