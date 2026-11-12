import { pipeline } from "../../pipeline/builder";
import type { ElementRegistry } from "../../pipeline/registry";
import {
  PredictInputElement,
  PredictIntentElement,
  PredictFinalizeElement,
} from "./elements";
import type { PredictionPipelineDeps } from "./elements";

export function registerPredictionElements(registry: ElementRegistry): void {
  registry.register("predict-input", PredictInputElement);
  registry.register("predict-intent", PredictIntentElement);
  registry.register("predict-finalize", PredictFinalizeElement);
}

export function predictionPipeline(deps: PredictionPipelineDeps) {
  return pipeline("prediction", deps.elementRegistry)
    .source("predict-input", { session: deps.session, task: deps.task })
    .transform(deps.decisionMode === "jev" ? "jev-decision" : "predict-intent", deps.decisionMode === "jev"
      ? { purpose: "prediction", model: deps.decisionModel, fallback: deps.fallbackModel, promptResolver: deps.promptResolver, maxTokens: deps.maxTokens }
      : {
        promptResolver: deps.promptResolver,
        apiKey: deps.apiKey,
        model: deps.model,
        provider: deps.provider,
        protocol: deps.protocol,
        baseUrl: deps.baseUrl,
        thinking: deps.thinking,
        options: deps.options,
        maxTokens: deps.maxTokens,
      })
    .boundary("token-ratio", { session: deps.session, configContextLimit: deps.configContextLimit, maxTokens: deps.maxTokens })
    .sink("predict-finalize", { orchestrator: deps.orchestrator, maxGlobalRounds: deps.maxGlobalRounds, skillService: deps.skillService });
}
