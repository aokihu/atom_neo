import { ToolRegistry } from "./registry";

import {
  readTool,
  writeTool,
  lsTool,
  treeTool,
  grepTool,
  cpTool,
  mvTool,
} from "./builtin/fs";
import { bashTool } from "./builtin/bash";
import {
  searchMemoryTool,
  saveMemoryTool,
  traverseMemoryTool,
  linkMemoryTool,
} from "./builtin/memory";

import type { ToolDefinition } from "@atom-neo/shared";

export const BASIC_TOOLS: ToolDefinition[] = [
  readTool, writeTool, lsTool, grepTool, treeTool,
  searchMemoryTool, traverseMemoryTool,
];

export const ADVANCED_TOOLS: ToolDefinition[] = [
  cpTool, mvTool, bashTool, saveMemoryTool, linkMemoryTool,
];

export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const t of [...BASIC_TOOLS, ...ADVANCED_TOOLS]) {
    registry.register(t);
  }
}
