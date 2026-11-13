import type {
  ContinuationDecision,
  ProviderProtocol,
  TodoItem,
  TodoTarget,
  ToolContextInjection,
  ToolDefinition,
  ToolResultMetadata,
  ToolsGroup,
} from "@atom-neo/shared";
import type { ModelMessage } from "ai";
import type { ContextService } from "@core/context/context-service";
import type { ElementMemory, ElementTask, PipelineSession } from "@core/session/element-session";
import type { SkillServiceLike } from "@core/skills/types";
import type { IntentToolInput } from "@core/tools/builtin/intent";
import type { ToolCallLedger } from "@core/tools/governance";
import type { ToolRecordStore } from "@core/tools/tool-record-store";
import type { createLanguageModel } from "@core/pipelines/shared/model-provider";
import type { ManualToolCall } from "../tool-loop";
import type { ConversationFlowState } from "../types";
import type { ToolStatusCollector } from "./tool-result-status";

/** One reported tool execution, queued per Tool name until the loop consumes it. */
export type ToolExecutionStatus = {
  content: string;
  rawOutput?: unknown;
  metadata: ToolResultMetadata;
  startedAt?: number;
  durationMs?: number;
};

export type LoopExitReason =
  | ""
  | "no_tool_calls"
  | "tools_forced_off"
  | "intent_follow_up"
  | "todo_handoff"
  | "reconciliation_updated"
  | "reconciliation_attempt_limit"
  | "model_step_limit"
  | "stream_error"
  | "timeout"
  | "cancelled";

/** Result of one model step; the loop owns tool execution and exit decisions. */
export type StepOutcome = {
  text: string;
  reasoning: string;
  calls: ManualToolCall[];
  usage: ModelUsage | undefined;
  cumulativeUsage: number;
  finishReason: string;
  failed: boolean;
  errorCode: number;
};

export type ModelUsage = {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number; noCacheTokens?: number };
};

export type ChunkClassification =
  | { kind: "reasoning"; text: string; offset: number }
  | { kind: "text"; text: string }
  | { kind: "tool-call"; call: ManualToolCall }
  | { kind: "finish"; finishReason?: string }
  | { kind: "error"; statusCode?: number; error: any }
  | { kind: "abort" }
  | { kind: "ignore" };

export type StreamTrace = {
  sessionId: string;
  taskId: string;
  parentTaskId: string | null;
  rootTaskId: string;
};

export type TodoTargetState = {
  todo: TodoItem;
  index: number;
};

export type StreamReporter = (eventName: string, payload: Record<string, unknown>) => void;
export type DomainEmitter = (eventName: string, payload: any) => void;

export type StreamConfig = {
  apiKey: string;
  model: string;
  provider: string;
  protocol: ProviderProtocol;
  baseUrl?: string;
  beforeCall?: (signal?: AbortSignal) => Promise<void>;
  maxTokens: number;
  maxSteps: number;
  providerOptions: Record<string, any>;
  taskIntent: string;
  session?: PipelineSession;
  configContextLimit: number;
  skillService?: SkillServiceLike;
  contextService: ContextService;
  toolRecordStore?: ToolRecordStore;
  memory?: ElementMemory;
  toolDefinitions: ReadonlyMap<string, ToolDefinition>;
  sameToolBatchNames: ReadonlySet<string>;
  mcpToolsRef?: { current: Record<string, any> };
  builtinTools: Record<string, any>;
  stepCounter: { count: number };
  statuses: ToolStatusCollector;
  governance: { current: ToolCallLedger };
};

export type StreamDeadlineLike = {
  pauseForBeforeCall(beforeCall: (signal?: AbortSignal) => Promise<void>, signal: AbortSignal): Promise<void>;
  dispose(): void;
};

export type StepContextLike = {
  readonly systemText: string;
  readonly currentSnapshotId?: string;
  readonly dirty: boolean;
  refresh(stepNumber: number): void;
  commit(failed: boolean, timedOut: boolean, signal: AbortSignal): void;
  release(): void;
  inject(injection: ToolContextInjection, stepNumber: number, toolName: string): { scope: ToolContextInjection["scope"]; key: string };
  completeStep(stepNumber: number): void;
};

/** Mutable state for one Element `doProcess` invocation. */
export type StreamRun = {
  config: StreamConfig;
  report: StreamReporter;
  reportTransport: StreamReporter;
  input: ConversationFlowState;
  task: ElementTask;
  request?: ContinuationDecision;
  reconcile: boolean;
  trace: StreamTrace;
  todoBefore: TodoItem[];
  currentTodo?: TodoTarget;
  todoHandoff: boolean;
  reconciliationAttempts: number;
  userMessages: ModelMessage[];
  model: ReturnType<typeof createLanguageModel>;
  availableTools: Record<string, any>;
  modelTools: Record<string, any>;
  toolNames: string[];
  modelMessages: ModelMessage[];
  allToolCalls: { toolName: string; metadata: ToolResultMetadata }[];
  toolsGroup?: ToolsGroup;
  intentData: IntentToolInput | null;
  fullText: string;
  reasoningText: string;
  transportReasoningLength: number;
  finishReason: string;
  streamFailed: boolean;
  streamErrorCode: number;
  timedOut: boolean;
  loopExitReason: LoopExitReason;
  lastStepToolsEnabled: boolean;
  completeDetected: boolean;
  cumulativeUsage: number;
  lastUsage: ModelUsage | undefined;
  modelStep: number;
  stepInstruction: string;
  forceFinalText: boolean;
  toolDefinitionsHash: string;
  context: StepContextLike;
  deadline: StreamDeadlineLike;
  signal: AbortSignal;
};
