export type CompressMode = "initial" | "summarizing" | "finalizing";

export type CompressFlowState = {
  mode: CompressMode;
  task: any;
  session: any;
  archiveMessages: Array<{ role: string; content: string; timestamp: number }>;
  keepCount?: number;
  summaryText: string;
  summary?: string;
  summaryMaxTokens: number;
};
