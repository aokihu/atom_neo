import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  EvaluatorInputElement,
  EvaluatorAnalyzeElement,
  EvaluateFinalizeElement,
} from "./elements";

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
  queue: any;
}) {
  return pipeline("follow-up-evaluator")
    .source("evaluator-input", { session: deps.session })
    .transform("evaluator-analyze", {
      apiKey: deps.apiKey,
      model: deps.model,
      baseUrl: deps.baseUrl,
      maxTokens: deps.maxTokens,
    })
    .sink("evaluate-finalize", { queue: deps.queue });
}
