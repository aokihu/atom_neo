// @atom-neo/core - Barrel exports
export { startCore } from "./server";
export type { CoreDeps } from "./server";

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
} from "@atom-neo/shared";

export { SessionStore } from "./session/store";
export { SessionPersistenceService } from "./session/persistence-service";
export type {
  ArchiveReceipt,
  HistoryMatch,
  PersistedSessionState,
  SessionCheckpointReason,
} from "./session/types";
export { compileContextSnapshot } from "./context/compiler";
export type { CompileContextOptions, ContextCompilation } from "./context/compiler";
export { ContextService } from "./context/context-service";
export type { PersistedContextBucket, PersistedContextState } from "./context/context-service";

// Tools
export { ToolRegistry } from "./tools/registry";
export { executeTool } from "./tools/executor";
export { filterToolsByPermission } from "./tools/permissions";
export { registerBuiltinTools, createAllTools } from "./tools/bootstrap";
export { initMCPClients, fetchMCPTools, closeMCPClients, startMCPHealthCheck, checkMCPHealth } from "./tools/mcp-manager";
export type { MCPServerConfig, MCPClient, MCPServerStatus } from "./tools/mcp-manager";
export {
  createReadTool, createWriteTool, createLsTool,
  createTreeTool, createGrepTool, createCpTool, createMvTool,
} from "./tools/builtin/fs";
export { createBashTool } from "./tools/builtin/bash";
export { createHistoryTools } from "./tools/builtin/history";
export {
  createSearchMemoryTool, createReadMemoryTool, createSaveMemoryTool,
  createTraverseMemoryTool, createLinkMemoryTool, createForgetMemoryTool,
} from "./tools/builtin/memory";

// Pipeline Builder
export { registerElement, resolveElement, getRegisteredNames, clearRegistry } from "./pipeline/registry";
export { pipeline, PipelineBuilder } from "./pipeline/builder";
export type { Pipeline } from "./pipeline/builder";
export { PipelineManager } from "./pipeline/manager";

// Pipelines
export {
  registerConversationElements,
  conversationPipeline,
  registerPredictionElements,
  predictionPipeline,
  registerFollowUpElements,
  followUpPipeline,
} from "./pipelines";
export type { ConversationPipelineDeps } from "./pipelines";

// Server
export { Broadcaster } from "./ws/broadcaster";
export { PipelineRecorder } from "./replay/recorder";
export { PipelinePlayer } from "./replay/player";
