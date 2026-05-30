import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import type { PredictionFlowState } from "./types";

export class PredictFinalizeElement extends BaseElement<PredictionFlowState, PipelineResult> {
  #orchestrator: InternalTaskOrchestrator;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
  }

  async doProcess(input: PredictionFlowState): Promise<PipelineResult> {
    const prediction = input.prediction ?? {
      toolTier: "basic",
      difficulty: "balanced",
      reasoning: "fallback",
    };

    const session = input.session;
    session.pendingPrediction = prediction;

    this.#orchestrator.scheduleConversation(
      session.sessionId,
      input.task.chatId,
      input.task.id,
      input.task.payload ?? [],
    );

    return {
      type: "complete",
      task: input.task,
      output: `prediction: toolTier=${prediction.toolTier}, difficulty=${prediction.difficulty}, reasoning=${prediction.reasoning}`,
    };
  }
}
