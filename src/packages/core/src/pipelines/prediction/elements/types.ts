import type { IntentPredictionResult } from "@atom-neo/shared";

export type PredictionMode = "initial" | "predicting" | "routing";

export type PredictionFlowState = {
  mode: PredictionMode;
  task: any;
  session: any;
  userMessage: string;
  contextMessages?: string;
  prediction?: IntentPredictionResult;
  error?: string;
};

export type PredictionPipelineDeps = {
  session: any;
  task: any;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  queue: any;
};
