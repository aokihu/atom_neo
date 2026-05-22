export type ConversationMode =
  | "initial"
  | "streaming"
  | "executing"
  | "ready_to_finalize";

export type ConversationFlowState = {
  mode: string;
  task: import("@atom-neo/shared").TaskItem;
  prompts?: Array<{ role: string; content: string }>;
  responseText?: string;
  followUp?: {
    summary: string;
    nextPrompt: string;
    avoidRepeat: string;
  };
};
