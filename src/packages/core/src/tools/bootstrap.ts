import { ToolRegistry } from "./registry";
import type { ToolDefinition } from "@atom-neo/shared";
import {
  createReadTool, createWriteTool, createLsTool, createTreeTool,
  createGrepTool, createCpTool, createMvTool, createSandbox,
} from "./builtin/fs";
import { createBashTool } from "./builtin/bash";
import {
  createSearchMemoryTool, createSaveMemoryTool,
  createTraverseMemoryTool, createLinkMemoryTool,
} from "./builtin/memory";
import { createToolGuard } from "./guard";

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
  ];
  return raw.map(t => createToolGuard(t, sandbox, whitelist ?? []));
}

const BASIC_NAMES = ["read", "write", "ls", "grep", "tree", "search_memory", "save_memory", "link_memory"];
const ADVANCED_NAMES = ["cp", "mv", "bash", "traverse_memory"];

export function partitionTools(all: ToolDefinition[]) {
  return {
    basic: all.filter(t => BASIC_NAMES.includes(t.name)),
    advanced: all.filter(t => ADVANCED_NAMES.includes(t.name)),
  };
}

export function registerBuiltinTools(registry: ToolRegistry, sandbox: string, whitelist?: string[]): void {
  for (const t of createAllTools(sandbox, undefined, whitelist)) {
    registry.register(t);
  }
}
