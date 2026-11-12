import type { DecisionModel } from "../../decision/choose";
import type { ToolRecordStore } from "../../tools/tool-record-store";
import { pipeline } from "../../pipeline/builder";
import type { ElementRegistry } from "../../pipeline/registry";
import {
  EvaluatorInputElement,
  EvaluatorAnalyzeElement,
  EvaluateFinalizeElement,
} from "./elements";
import type { InternalTaskOrchestrator } from "../../task/internal-task-orchestrator";
import type { ContextService } from "../../context/context-service";
import type { PromptResolver, ProviderProtocol } from "@atom-neo/shared";

export function registerFollowUpEvaluatorElements(registry: ElementRegistry): void {
  registry.register("evaluator-input", EvaluatorInputElement);
  registry.register("evaluator-analyze", EvaluatorAnalyzeElement);
  registry.register("evaluate-finalize", EvaluateFinalizeElement);
}

export function followUpEvaluatorPipeline(deps: {
  elementRegistry: ElementRegistry;
  decisionModel?: DecisionModel;
  fallbackModel?: DecisionModel;
  toolRecordStore?: ToolRecordStore;
  session: any;
  task: any;
  promptResolver: PromptResolver;
  apiKey: string;
  model: string;
  provider?: string;
  protocol?: ProviderProtocol;
  baseUrl?: string;
  options?: Record<string, unknown>;
  maxTokens?: number;
  orchestrator: InternalTaskOrchestrator;
  configContextLimit?: number;
  contextService: ContextService;
}) {
  return pipeline("follow-up-evaluator", deps.elementRegistry)
    .source("evaluator-input", { session: deps.session, toolRecordStore: deps.toolRecordStore })
    .transform("evaluator-analyze", {
      decisionModel: deps.decisionModel, fallbackModel: deps.fallbackModel,
      promptResolver: deps.promptResolver,
      apiKey: deps.apiKey,
      model: deps.model,
      provider: deps.provider,
      protocol: deps.protocol,
      baseUrl: deps.baseUrl,
      options: deps.options,
      maxTokens: deps.maxTokens,
    })
    .boundary("token-ratio", { session: deps.session, configContextLimit: deps.configContextLimit, maxTokens: deps.maxTokens })
    .sink("evaluate-finalize", {
      orchestrator: deps.orchestrator,
      contextService: deps.contextService,
      configContextLimit: deps.configContextLimit,
      maxTokens: deps.maxTokens,
    });
}
