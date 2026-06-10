import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import { BusEvents, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import { DEFAULT_CONTEXT_LIMIT } from "../../../constants";
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

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator;
    configContextLimit?: number;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#configContextLimit = params.configContextLimit ?? DEFAULT_CONTEXT_LIMIT;
  }

  async doProcess(input: EvaluatorFlowState): Promise<PipelineResult> {
    const { health, suggestion, upgradeModel, reason } = input.evaluation ?? FALLBACK;

    this.report(BusEvents.Element.Data, { step: "decision", health, suggestion, upgradeModel, reason, summaryLen: input.recentSummary.length });

    if (health === "stuck") {
      const tmpl = resolvePrompt(PromptKey.EVALUATE_STUCK);
      const termMsg = reason
        ? tmpl.replace("%s", reason)
        : tmpl.replace("%s", "").replace(/(原因|Reason):\s*/g, "").replace(/\s+/g, " ").trim();
      input.session.addMessage
        ? input.session.addMessage({ role: "assistant", content: termMsg, visible: true, pipeline: "follow-up-evaluator", timestamp: Date.now() })
        : null;
      this.report(BusEvents.Element.Data, { step: "stuck, stopping chain", reason });
      return { type: "complete", task: input.task, output: `evaluator: stuck — ${reason}` };
    }

    if (health !== "healthy") {
      input.session.evaluatorSuggestion = suggestion;
      input.session.upgradeModel = upgradeModel ?? false;
    }

    const tu = input.session?.tokenUsage?.total ?? 0;
    const limit = this.#configContextLimit ?? DEFAULT_CONTEXT_LIMIT;
    if (tu > limit * 0.8 && health !== "stuck") {
      this.report(BusEvents.Element.Data, { step: "token usage high, scheduling compress", total: tu, limit });
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
