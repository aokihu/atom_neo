import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  PredictInputElement,
  PredictIntentElement,
  PredictFinalizeElement,
} from "./elements";
import type { PredictionPipelineDeps } from "./elements";

export function registerPredictionElements(): void {
  registerElement("predict-input", PredictInputElement);
  registerElement("predict-intent", PredictIntentElement);
  registerElement("predict-finalize", PredictFinalizeElement);
}

export function predictionPipeline(deps: PredictionPipelineDeps) {
  return pipeline("prediction")
    .source("predict-input", { session: deps.session, task: deps.task })
    .transform("predict-intent", {
      apiKey: deps.apiKey,
      model: deps.model,
      baseUrl: deps.baseUrl,
      maxTokens: deps.maxTokens,
    })
    .boundary("token-ratio", { session: deps.session, configContextLimit: deps.configContextLimit, maxTokens: deps.maxTokens })
    .sink("predict-finalize", { orchestrator: deps.orchestrator });
}
