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
  #logger: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    queue: TaskQueue;
    logger?: any;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#queue = params.queue;
    this.#logger = params.logger;
  }

  async doProcess(input: EvaluatorFlowState): Promise<PipelineResult> {
    const { health, suggestion, upgradeModel, reason } = input.evaluation ?? FALLBACK;

    this.#logger?.debug("evaluate-finalize: decision", {
      health, suggestion, upgradeModel, reason,
      summaryLen: input.recentSummary.length,
    });

    if (health === "stuck") {
      const termMsg = reason
        ? `(任务过长，已自动中断。原因: ${reason})`
        : "(任务过长，已自动中断。)";
      input.session.addMessage
        ? input.session.addMessage({ role: "assistant", content: termMsg, visible: true, pipeline: "follow-up-evaluator", timestamp: Date.now() })
        : null;
      this.#logger?.info("evaluate-finalize: stuck, stopping chain", { reason });
      return { type: "complete", task: input.task, output: `evaluator: stuck — ${reason}` };
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
