import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import { BaseElement, PipelineEventBus } from "@atom-neo/shared";
import type { PipelineEventMap } from "@atom-neo/shared";

// ── Stub Elements ──
class PredictionSourceElement extends BaseElement<any, any> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "source", bus: params.bus });
  }
  async doProcess(input: any) {
    if (input.mode !== "initial") return input;
    return { mode: "predicting", ...input };
  }
}

class PredictionSinkElement extends BaseElement<any, any> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
  }
  async doProcess(input: any) {
    return { type: "complete", ...input };
  }
}

export function registerPredictionElements(): void {
  registerElement("prediction-source", PredictionSourceElement as any);
  registerElement("prediction-sink", PredictionSinkElement as any);
}

export function predictionPipeline() {
  return pipeline("prediction")
    .source("prediction-source", {})
    .sink("prediction-sink", {});
}
