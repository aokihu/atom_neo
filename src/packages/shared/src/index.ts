export { isAdminRequest } from "./utils/admin-auth";
export { createChildProcessEnv } from "./utils/child-process-env";
export { spawnProcess } from "./utils/process";
export type { ProcessHandle, SpawnProcessOptions } from "./utils/process";

// ── Types ──
export {
  TaskSource,
  TaskState,
  TaskPriority,
  IntentRequestType,
  IntentRequestSource,
  PermissionLevel,
  PipelineResultType,
  PipelineEnqueueTransition,
  MEMORY_KIND_VALUES,
} from "./types";
export type {
  SessionInitiator,
  UUID,
  ISOTimeString,
  TaskItem,
  TaskOrigin,
  TaskPayload,
  ContextCompressRequest,
  ContinuationDecision,
  TodoItem,
  TodoTarget,
  TaskToolCall,
  TaskToolReport,
  ToolReportFact,
  IntentRequest,
  FollowUpIntentRequest,
  DifficultyLevel,
  ModelProfile,
  IntentClass,
  ContextRelevance,
  IntentPredictionResult,
  MemoryNode,
  MemoryLink,
  MemoryKind,
  MemoryScope,
  MemorySearchRequest,
  MemorySearchResult,
  SkillSectionMeta,
  SkillDef,
  SkillListItem,
  SkillLoadResult,
  WebFetchMethod,
  WebFetchRequest,
  NetworkRequestOptions,
  WebFetchResultCode,
  WebFetchRateLimit,
  WebFetchResponse,
  NetworkServiceLike,
  ToolDefinition,
  ToolResult,
  ToolEffect,
  ToolErrorSource,
  ToolResultMetadata,
  ToolExecuteOptions,
  ToolContextInjection,
  ToolRecordStatus,
  ToolRecord,
  ToolsGroupStatus,
  ToolsGroup,
  ToolRecordSummary,
  ToolsGroupSummary,
  PipelineResult,
  FlowState,
  ConversationContinuationAction,
  ConversationChainAction,
  PipelineEventMap,
  CoreEventMap,
  DomainEventMap,
  FullEventMap,
  SessionMessage,
  SessionTelemetry,
  InferenceFact,
  ToolContext,
  ToolResultEntry,
  ScopeState,
  MemoryScopeState,
  ContinuationContext,
  ContextScope,
  ContextChannel,
  ContextRetention,
  ContextTrust,
  ContextLifecycleState,
  ContextSnapshotStatus,
  ContextLifecycleEvent,
  ContextOwner,
  ContextLifecycle,
  ContextMessage,
  ContextEntry,
  ContextBucket,
  ContextPutRequest,
  ContextSnapshotRequest,
  ContextFragment,
  ContextReceipt,
  ContextManifestEntry,
  ContextSnapshot,
  SnapshotRecordRef,
  ContextSnapshotState,
  ScheduledTask,
  HookTrigger,
  Hook,
} from "./types";

// ── Pipeline ──
export {
  BaseElement,
  PipelineEventBus,
  PipelineRunner,
  READY_TO_FINALIZE,
} from "./pipeline";
export type {
  PipelineElementKind,
  PipelineDefinition,
  PipelineElementDef,
} from "./pipeline";

// ── Config ──
export {
  ConfigSchema,
  RuntimeConfigSchema,
  ClientConfigSchema,
  ProviderProfilesSchema,
  ProviderDefinitionSchema,
  PROVIDERS,
  DEFAULT_PROFILES,
  DEFAULT_DECISION_MODES,
  OPENROUTER_JEV,
  PROVIDER_TYPES,
  THINKING_MODES,
  THEME_NAMES,
  DEFAULT_THEME,
  isThemeName,
  mergeConfig,
  overlaySchema,
  runtimeConfigPath,
} from "./config";
export type {
  AppConfig,
  RuntimeConfig,
  DeepPartial,
  ClientConfig,
  ProviderType,
  ProviderPreset,
  ThinkingMode,
  DecisionModes,
  ThemeName,
} from "./config";

// ── Protocol ──
export type {
  ClientEvent,
  ServerEvent,
  TaskSubmitPayload,
  ElementStartedPayload,
  ElementFinishedPayload,
  DecisionUpdatePayload,
  TransportReasonPayload,
  TransportDeltaPayload,
  ToolStartedPayload,
  ToolFinishedPayload,
  ToolStepFinishedPayload,
  ToolGroupCompletePayload,
  TaskCompletedPayload,
  TaskFailedPayload,
  TaskStatePayload,
  ReplayStartPayload,
  ReplayEndPayload,
} from "./protocol";

// ── Log ──
export { Logger, LogHub, StdoutSink, FileSink, PipeSink } from "./log";
export type { LogLevel, LogEntry, LogSink } from "./log";

// ── Utils ──
export { normalizeError, errorMessage, substringWellFormed, truncate, slugify, sanitizeForJSON, sleep, debounce, stringWidth, areMemorySearchQueriesSimilar, canonicalizeMemorySearchQuery, containsSkillHint, parseMemorySearchTerms, parseEnv, parseEnvEntries, parseEnvKeys, serializeEnv, upsertEnv, mergeEnv, writeFileAtomic, createId, clamp, parsePortValue } from "./utils";
export type { EnvEntry, WriteFileAtomicOptions } from "./utils";

// ── Constants ──
export { BusEvents, TaskFailureCodes, WsMessages } from "./constants";

// ── Prompts ──
export { PromptKey, initPromptRegistry, resolvePrompt, getRegistry } from "./prompts";
export type { PromptRegistry } from "./prompts";
