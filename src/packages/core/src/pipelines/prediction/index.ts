import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  PredictInputElement,
  PredictIntentElement,
  RouteConversationElement,
} from "./elements";
import type { PredictionPipelineDeps } from "./elements";

export function registerPredictionElements(): void {
  registerElement("predict-input", PredictInputElement);
  registerElement("predict-intent", PredictIntentElement);
  registerElement("route-conversation", RouteConversationElement);
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
    .sink("route-conversation", { buildConversation: deps.buildConversation });
}
