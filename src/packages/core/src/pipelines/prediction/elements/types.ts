import type { IntentPredictionResult, PromptResolver, ProviderProtocol } from "@atom-neo/shared";
import type { ElementTask, PipelineSession } from "@core/session/element-session";
import type { InternalTaskOrchestrator } from "@core/task/internal-task-orchestrator";
import type { SkillServiceLike } from "@core/skills/types";
import type { DecisionModel } from "@core/decision/choose";
import type { ElementRegistry } from "@core/pipeline/registry";

export type PredictionMode = "initial" | "predicting" | "routing";

export type PreviousTurnContext = {
  user: string;
  assistant: string;
};

export type PredictionFlowState = {
  mode: PredictionMode;
  task: ElementTask;
  session: PipelineSession;
  userMessage: string;
  currentTopic: string;
  previousTurnContext?: PreviousTurnContext;
  prediction?: IntentPredictionResult;
  error?: string;
  abortSignal?: AbortSignal;
};

export type PredictionPipelineDeps = {
  elementRegistry: ElementRegistry;
  session: PipelineSession;
  task: ElementTask;
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
