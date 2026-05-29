import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import { TaskSource } from "@atom-neo/shared";
import { createTaskItem } from "../../../task-factory";
import type { TaskQueue } from "../../../task-queue";
import type { EvaluatorFlowState, EvaluatorResult } from "./types";

const FALLBACK: EvaluatorResult = {
  health: "healthy",
  suggestion: "",
  upgradeModel: false,
  reason: "fallback",
};

export class EvaluateFinalizeElement extends BaseElement<EvaluatorFlowState, PipelineResult> {
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

  async doProcess(input: EvaluatorFlowState): Promise<PipelineResult> {
    const { health, suggestion, upgradeModel, reason } = input.evaluation ?? FALLBACK;

    if (health === "stuck") {
      const termMsg = reason
        ? `(任务过长，已自动中断。原因: ${reason})`
        : "(任务过长，已自动中断。)";
      input.session.addMessage
        ? input.session.addMessage({ role: "assistant", content: termMsg, visible: true, pipeline: "follow-up-evaluator" })
        : null;
      return { type: "complete", task: input.task, output: termMsg };
    }

    if (health !== "healthy") {
      input.session.evaluatorSuggestion = suggestion;
      input.session.upgradeModel = upgradeModel ?? false;
    }

    const convTask = createTaskItem({
      sessionId: input.session.sessionId,
      chatId: input.task.chatId,
      pipeline: "conversation",
      source: TaskSource.INTERNAL,
      parentTaskId: input.task.parentTaskId ?? input.task.id,
      payload: [{ type: "text", data: "请继续，不要重复已输出的内容。" }],
    });

    this.#queue.enqueue(convTask);

    return {
      type: "complete",
      task: input.task,
      output: `evaluator: health=${health}`,
    };
  }
}
