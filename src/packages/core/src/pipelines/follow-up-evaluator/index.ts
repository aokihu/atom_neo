import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  EvaluatorInputElement,
  EvaluatorAnalyzeElement,
  EvaluateFinalizeElement,
} from "./elements";
import type { InternalTaskOrchestrator } from "../../task/internal-task-orchestrator";

export function registerFollowUpEvaluatorElements(): void {
  registerElement("evaluator-input", EvaluatorInputElement);
  registerElement("evaluator-analyze", EvaluatorAnalyzeElement);
  registerElement("evaluate-finalize", EvaluateFinalizeElement);
}

export function followUpEvaluatorPipeline(deps: {
  session: any;
  task: any;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  orchestrator: InternalTaskOrchestrator;
  configContextLimit?: number;
}) {
  return pipeline("follow-up-evaluator")
    .source("evaluator-input", { session: deps.session })
    .transform("evaluator-analyze", {
      apiKey: deps.apiKey,
      model: deps.model,
      baseUrl: deps.baseUrl,
      maxTokens: deps.maxTokens,
    })
    .boundary("token-ratio", { session: deps.session, configContextLimit: deps.configContextLimit, maxTokens: deps.maxTokens })
    .sink("evaluate-finalize", { orchestrator: deps.orchestrator, configContextLimit: deps.configContextLimit, maxTokens: deps.maxTokens });
}
