import type { IntentPredictionResult } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import type { SkillServiceLike } from "../../../skills/types";

export type PredictionMode = "initial" | "predicting" | "routing";

export type PredictionFlowState = {
  mode: PredictionMode;
  task: any;
  session: any;
  userMessage: string;
  contextMessages?: string;
  prediction?: IntentPredictionResult;
  error?: string;
  abortSignal?: AbortSignal;
};

export type PredictionPipelineDeps = {
  session: any;
  task: any;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  orchestrator: InternalTaskOrchestrator;
  configContextLimit?: number;
  skillService?: SkillServiceLike;
};
