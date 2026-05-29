import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import type { IntentPredictionResult } from "@atom-neo/shared";
import type { PredictionFlowState } from "./types";

export class RouteConversationElement extends BaseElement<PredictionFlowState, PipelineResult> {
  #buildConversation: (session: any, prediction: IntentPredictionResult) => void;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    buildConversation: (session: any, prediction: IntentPredictionResult) => void;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#buildConversation = params.buildConversation;
  }

  async doProcess(input: PredictionFlowState): Promise<PipelineResult> {
    const prediction = input.prediction ?? {
      toolTier: "basic",
      difficulty: "balanced",
      reasoning: "fallback",
    };

    this.#buildConversation(input.session, prediction);

    return {
      type: "complete",
      task: input.task,
      output: `prediction: toolTier=${prediction.toolTier}, difficulty=${prediction.difficulty}, reason=${prediction.reasoning}`,
    };
  }
}
