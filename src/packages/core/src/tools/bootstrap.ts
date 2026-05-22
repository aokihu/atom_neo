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

export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.register(readTool);
  registry.register(writeTool);
  registry.register(lsTool);
  registry.register(treeTool);
  registry.register(grepTool);
  registry.register(cpTool);
  registry.register(mvTool);
  registry.register(bashTool);
  registry.register(searchMemoryTool);
  registry.register(saveMemoryTool);
  registry.register(traverseMemoryTool);
  registry.register(linkMemoryTool);
}
