export type PostConversationMode = "initial" | "analyzing" | "acting";

export type AnalysisResult = {
  status: "satisfactory" | "blocked" | "needs_user_input";
  reason: string;
  fingerprint?: string;
};

export const FALLBACK_ANALYSIS: AnalysisResult = { status: "satisfactory", reason: "analysis skipped, continuing" };

export const STALL_THRESHOLD = 0.6;

export type PostConversationFlowState = {
  mode: PostConversationMode;
  task: any;
  session: any;
  userMessage: string;
  assistantResponse: string;
  predictedTaskIntent: string;
  stepCount: number;
  assistantParts: number;
  assistantLength: number;
  activeTodoCount: number;
  finishReason: string;
  completeDetected: boolean;
  analysis?: AnalysisResult;
};
