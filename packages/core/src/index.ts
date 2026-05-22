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
