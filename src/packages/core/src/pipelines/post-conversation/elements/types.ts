export type PostConversationMode = "initial" | "analyzing" | "acting";

export type AnalysisResult = {
  status: "satisfactory" | "blocked";
  reason: string;
};

export const FALLBACK_ANALYSIS: AnalysisResult = { status: "satisfactory", reason: "analysis skipped, continuing" };

export type PostConversationFlowState = {
  mode: PostConversationMode;
  task: any;
  session: any;
  userMessage: string;
  assistantResponse: string;
  predictedTaskIntent: string;
  stepCount: number;
  assistantParts: number;
  analysis?: AnalysisResult;
};
