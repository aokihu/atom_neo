import type { ToolEffectSummary } from "@core/pipelines/conversation/elements/types";
import type { ElementTask, PipelineSession } from "@core/session/element-session";

export type PostConversationMode = "initial" | "analyzing" | "acting";

export type AnalysisResult = {
  status: "satisfactory" | "blocked" | "needs_user_input";
  reason: string;
  fingerprint?: string;
  assessment?: Record<string, string>;
  confirmed?: boolean;
};

export const FALLBACK_ANALYSIS: AnalysisResult = { status: "satisfactory", reason: "analysis skipped, continuing" };

export const STALL_THRESHOLD = 0.6;

export type PostConversationFlowState = {
  mode: PostConversationMode;
  task: ElementTask;
  session: PipelineSession;
  userMessage: string;
  assistantResponse: string;
  predictedTaskIntent: string;
  stepCount: number;
  assistantParts: number;
  assistantLength: number;
  activeTodoCount: number;
  finishReason: string;
  completeDetected: boolean;
  toolEffectSummary: ToolEffectSummary;
  progressEvidence?: import("@core/pipelines/shared/progress-evidence").ProgressEvidence;
  analysis?: AnalysisResult;
  abortSignal?: AbortSignal;
  executionGoalId?: string;
};
