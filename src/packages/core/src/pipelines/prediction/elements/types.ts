import type { IntentPredictionResult, PromptResolver, ProviderProtocol } from "@atom-neo/shared";
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
  promptResolver: PromptResolver;
  apiKey: string;
  model: string;
  provider?: string;
  protocol?: ProviderProtocol;
  baseUrl?: string;
  thinking?: string;
  options?: Record<string, unknown>;
  decisionMode?: "legacy" | "jev";
  decisionModel?: DecisionModel;
  fallbackModel?: DecisionModel;
  maxTokens?: number;
  orchestrator: InternalTaskOrchestrator;
  maxGlobalRounds?: number;
  configContextLimit?: number;
  skillService?: SkillServiceLike;
};
