export type PostConversationMode = "initial" | "analyzing" | "acting";

export type AnalysisResult = {
  status: "satisfactory" | "blocked" | "incomplete";
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
  analysis?: AnalysisResult;
};
