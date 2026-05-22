// @atom-neo/core - Barrel exports
export { loadCoreConfig } from "./config";
export type { CoreConfig } from "./config";

export { TaskQueue } from "./task-queue";
export { TaskEngine } from "./task-engine";
export { createTaskItem, createContinuationTask } from "./task-factory";

export { SessionContext } from "./session/context";
export type {
  InferenceFact,
  ToolContext,
  ScopeState,
  MemoryScopeState,
  ContinuationContext,
} from "./session/context";

export { SessionStore } from "./session/store";

// Tools
export { ToolRegistry } from "./tools/registry";
export { executeTool } from "./tools/executor";
export { filterToolsByPermission } from "./tools/permissions";
export { registerBuiltinTools } from "./tools/bootstrap";
export {
  readTool,
  writeTool,
  lsTool,
  treeTool,
  grepTool,
  cpTool,
  mvTool,
} from "./tools/builtin/fs";
export { bashTool } from "./tools/builtin/bash";
export {
  searchMemoryTool,
  saveMemoryTool,
  traverseMemoryTool,
  linkMemoryTool,
} from "./tools/builtin/memory";
