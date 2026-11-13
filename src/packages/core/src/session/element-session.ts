import type {
  IntentPredictionResult,
  SessionMessage,
  TaskItem,
  TaskPayload,
  TodoItem,
  ToolResultEntry,
} from "@atom-neo/shared";
import type {
  ExecutionBudget,
  PersistedSessionState,
  PersistedSessionStatus,
  SessionArchiveState,
  SessionCheckpointReason,
} from "./types";

/** Element-facing Task shape: TaskItem remains the single task type. */
export type ElementTask = TaskItem;

/** Session messages may carry assistant reasoning beyond the shared message shape. */
export type PipelineMessage = SessionMessage & { reasoningContent?: string };

/** Typed task payload lookup for Element boundaries. */
type TaskPayloadData = { [P in TaskPayload as P["type"]]: P["data"] };

export function getTaskPayload<T extends TaskPayload["type"]>(
  task: Pick<ElementTask, "payload"> | undefined,
  type: T,
): TaskPayloadData[T] | undefined {
  const part = task?.payload?.find(item => item.type === type);
  return part?.data as TaskPayloadData[T] | undefined;
}

/** Prediction fields actually read through a PipelineSession. */
export type ElementPrediction = Partial<IntentPredictionResult> & { stepCount?: number };

/** Memory capabilities used by Element intent handling. */
export type ElementMemory = {
  retain(id: string): void;
  findFullId?(id: string): string | null;
  has?(id: string): boolean;
};

/**
 * Structural Session boundary for Elements. Every member has a real Element
 * call site; this is not a general SessionStore/HTTP contract.
 */
export interface PipelineSession {
  readonly sessionId: string;
  readonly messages: readonly PipelineMessage[];
  readonly todoState: readonly TodoItem[];
  readonly currentTopic: string | null;
  readonly contextTokens: number;
  readonly lastSafeMsgCount: number;
  pendingPrediction?: ElementPrediction;
  readonly originalSource?: string;
  readonly postCheckFingerprints: readonly string[];
  executionBudget?: ExecutionBudget;
  legacyBudgetDepth?: number;
  compressRetry: number;
  compressRatio: number;
  compressing: boolean;

  addMessage(message: SessionMessage): void;
  removeMessages(seqs: readonly number[]): number;
  setContextTokens(total: number): void;
  addToolResult(result: ToolResultEntry): void;
  setTodoState(items: TodoItem[]): void;
  resetForNewTopic(topic: string): void;
  clearContinuationContext(): void;
  addPostCheckFingerprint(fp: string): void;
}

/** PipelineSession plus the checkpoint capability required by context compression. */
export type CheckpointSession = PipelineSession & {
  exportState(params: {
    checkpointRevision: number;
    status: PersistedSessionStatus;
    archives: SessionArchiveState;
    reason?: SessionCheckpointReason;
  }): PersistedSessionState;
};
