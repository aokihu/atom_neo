import type { ContinuationDecision, TodoTarget, ContextOwner, ContextSnapshot, ConversationContinuationAction, IntentRequest } from "@atom-neo/shared";
import type { ElementTask } from "@core/session/element-session";
import type { TokenUsage } from "@core/session/context";

export type ConversationMode =
  | "initial"
  | "streaming"
  | "context_recorded"
  | "formatted"
  | "executing"
  | "ready_to_finalize";

export type Message = { role: string; content: string; reasoning_content?: string };

export type ToolEffectSummary = {
  evidence: number;
  referenceEvidence: number;
  stateChanged: number;
  none: number;
  failed: number;
};

export type ConversationFlowState = {
  mode: ConversationMode;
  task: ElementTask;
  prompts?: Array<{ role: string; content: string; reasoning_content?: string }>;
  systemPrompt?: string;
  compiledAgentsPrompt?: string;
  skillContext?: string;
  skillContextRevision?: number;
  contextData?: string;
  contextOwner?: ContextOwner;
  contextSnapshot?: ContextSnapshot;
  contextSnapshotAccepted?: boolean;
  systemText?: string;
  userMessages?: Message[];
  responseText?: string;
  reasoningContent?: string;
  followUp?: {
    summary: string;
    nextPrompt: string;
    avoidRepeat: string;
  };
  chainAction?: ConversationContinuationAction;
  continuationDecision?: ContinuationDecision;
  progressTrace?: import("@core/pipelines/shared/progress-evidence").ProgressTrace;
  todoBefore?: import("@atom-neo/shared").TodoItem[];
  currentTodo?: TodoTarget;
  todoHandoff?: boolean;
  toolStopReason?: string;
  streamInterrupted?: boolean;
  cancelled?: boolean;
  suppressPostCheck?: boolean;
  intents?: IntentRequest[];
  tokenUsage?: TokenUsage;
  tokenOverflow?: boolean;
  errorStatusCode?: number;
  finishReason?: string;
  completeDetected?: boolean;
  toolEffectSummary?: ToolEffectSummary;
  abortSignal?: AbortSignal;
};
