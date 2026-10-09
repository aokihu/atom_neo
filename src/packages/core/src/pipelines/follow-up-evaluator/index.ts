import type { DecisionModel } from "../../decision/choose";
import type { ToolRecordStore } from "../../tools/tool-record-store";
import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  EvaluatorInputElement,
  EvaluatorAnalyzeElement,
  EvaluateFinalizeElement,
} from "./elements";
import type { InternalTaskOrchestrator } from "../../task/internal-task-orchestrator";
import type { ContextService } from "../../context/context-service";

export function registerFollowUpEvaluatorElements(): void {
  registerElement("evaluator-input", EvaluatorInputElement);
  registerElement("evaluator-analyze", EvaluatorAnalyzeElement);
  registerElement("evaluate-finalize", EvaluateFinalizeElement);
}

export function followUpEvaluatorPipeline(deps: {
  decisionModel?: DecisionModel;
  fallbackModel?: DecisionModel;
  toolRecordStore?: ToolRecordStore;
  session: any;
  task: any;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  orchestrator: InternalTaskOrchestrator;
  configContextLimit?: number;
  contextService: ContextService;
}) {
  return pipeline("follow-up-evaluator")
    .source("evaluator-input", { session: deps.session, toolRecordStore: deps.toolRecordStore })
    .transform("evaluator-analyze", {
      decisionModel: deps.decisionModel, fallbackModel: deps.fallbackModel,
      apiKey: deps.apiKey,
      model: deps.model,
      baseUrl: deps.baseUrl,
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
