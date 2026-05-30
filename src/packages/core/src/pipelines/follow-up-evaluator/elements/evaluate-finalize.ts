import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import type { EvaluatorFlowState, EvaluatorResult } from "./types";

const FALLBACK: EvaluatorResult = {
  health: "healthy",
  suggestion: "",
  upgradeModel: false,
  reason: "fallback",
};

export class EvaluateFinalizeElement extends BaseElement<EvaluatorFlowState, PipelineResult> {
  #orchestrator: InternalTaskOrchestrator;
  #configContextLimit: number;
  #logger: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator;
    configContextLimit?: number;
    logger?: any;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#configContextLimit = params.configContextLimit ?? 131072;
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

    const tu = input.session?.tokenUsage?.total ?? 0;
    const limit = this.#configContextLimit ?? 131072;
    if (tu > limit * 0.8 && health !== "stuck") {
      this.#logger?.info("evaluate-finalize: token usage high, scheduling compress", { total: tu, limit });
      this.#orchestrator.scheduleCompress(
        input.session.sessionId,
        input.task.chatId,
        input.task.parentTaskId ?? input.task.id,
      );
      return { type: "complete", task: input.task, output: `evaluator: health=${health}, compress scheduled` };
    }

    this.#orchestrator.scheduleConversation(
      input.session.sessionId,
      input.task.chatId,
      input.task.parentTaskId ?? input.task.id,
    );

    return {
      type: "complete",
      task: input.task,
      output: `evaluator: health=${health}`,
    };
  }
}
