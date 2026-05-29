import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import { TaskSource } from "@atom-neo/shared";
import { createTaskItem } from "../../../task-factory";
import type { TaskQueue } from "../../../task-queue";
import type { PredictionFlowState } from "./types";

export class PredictFinalizeElement extends BaseElement<PredictionFlowState, PipelineResult> {
  #queue: TaskQueue;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    queue: TaskQueue;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#queue = params.queue;
  }

  async doProcess(input: PredictionFlowState): Promise<PipelineResult> {
    const prediction = input.prediction ?? {
      toolTier: "basic",
      difficulty: "balanced",
      reasoning: "fallback",
    };

    const session = input.session;
    session.pendingPrediction = prediction;

    const convTask = createTaskItem({
      sessionId: session.sessionId,
      chatId: input.task.chatId,
      pipeline: "conversation",
      source: TaskSource.INTERNAL,
      parentTaskId: input.task.id,
      payload: input.task.payload ?? [],
    });

    this.#queue.enqueue(convTask);

    return {
      type: "complete",
      task: input.task,
      output: `prediction: toolTier=${prediction.toolTier}, difficulty=${prediction.difficulty}, reasoning=${prediction.reasoning}`,
    };
  }
}
