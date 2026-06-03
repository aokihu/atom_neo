export type PostConversationMode = "initial" | "analyzing" | "acting";

export type AnalysisResult = {
  status: "satisfactory" | "blocked";
  reason: string;
};

export type PostConversationFlowState = {
  mode: PostConversationMode;
  task: any;
  session: any;
  userMessage: string;
  assistantResponse: string;
  predictedToolTier: string;
  predictedTaskIntent: string;
  stepCount: number;
  assistantParts: number;
  analysis?: AnalysisResult;
};
