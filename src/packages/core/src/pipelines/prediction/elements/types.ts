import type { IntentPredictionResult } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import type { SkillServiceLike } from "../../../skills/types";
import type { DecisionModel } from "../../../decision/choose";

export type PredictionMode = "initial" | "predicting" | "routing";

export type PreviousTurnContext = {
  user: string;
  assistant: string;
};

export type PredictionFlowState = {
  mode: PredictionMode;
  task: any;
  session: any;
  userMessage: string;
  currentTopic: string;
  previousTurnContext?: PreviousTurnContext;
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
  thinking?: string;
  decisionMode?: "legacy" | "jev";
  decisionModel?: DecisionModel;
  fallbackModel?: DecisionModel;
  maxTokens?: number;
  orchestrator: InternalTaskOrchestrator;
  maxGlobalRounds?: number;
  configContextLimit?: number;
  skillService?: SkillServiceLike;
};
