import { BaseElement, BusEvents, PipelineResultType } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_MAX_TOKENS } from "../../../constants";
import { calcTokenRatio, applyCompressRatio } from "../../shared";
import { budgetPauseMessage } from "../../../session/execution-budget";
import type { ExecutionBudget } from "../../../session/types";
import type { ContextService } from "../../../context/context-service";
import type { EvaluatorFlowState } from "./types";
import { FALLBACK_EVALUATOR } from "./types";

export class EvaluateFinalizeElement extends BaseElement<EvaluatorFlowState, PipelineResult> {
  #orchestrator: InternalTaskOrchestrator;
  #contextLimit: number;
  #maxTokens: number;
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator; configContextLimit?: number; maxTokens?: number; contextService: ContextService }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#contextLimit = params.configContextLimit ?? DEFAULT_CONTEXT_LIMIT;
    this.#maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async doProcess(input: EvaluatorFlowState): Promise<PipelineResult> {
    input.abortSignal?.throwIfAborted();
    const budget = input.session.executionBudget as ExecutionBudget | undefined;
    const check = input.budgetCheck;
    const evaluation = input.evaluation ?? FALLBACK_EVALUATOR;
    if (!budget || !check || check.goalId !== budget.goalId || check.windowId !== budget.windowId || budget.pause !== "health_check") {
      this.report(BusEvents.Element.Data, { step: "stale-check-rejected", taskId: input.task.id, check });
      return { type: PipelineResultType.Complete, task: input.task, output: "evaluator: stale or missing window" };
    }
    const before = structuredClone(budget);
    let budgetPauseText: string | undefined;
    if (evaluation.health === "healthy" && budget.pendingTask && budget.globalUsed < budget.globalAllowance) {
      budget.localUsed = 0;
      budget.windowId++;
      budget.windowStartSeq = (input.session.messages.at(-1)?.seq ?? 0) + 1;
      budget.todoBaseline = structuredClone([...input.session.todoState]);
      budget.legacyEvidenceMissing = false;
      budget.pause = undefined;
      // Task.Completed checkpoints the new window before commit releases this exact request.
      const ratio = calcTokenRatio(input.session.contextTokens ?? 0, this.#contextLimit, this.#maxTokens);
      if (ratio > 0.8 && !input.session.compressing) {
        applyCompressRatio(input.session, ratio);
        this.#orchestrator.scheduleCompress(input.task.sessionId, input.task.chatId, input.task.parentTaskId ?? input.task.id,
          { trigger: "context-pressure", resumeConversation: true, resumeTask: budget.pendingTask,
            continuation: budget.pendingTask.payload.find(part => part.type === "continuation_request")?.data }, input.task.id);
      } else this.#orchestrator.releaseTask(budget.pendingTask, input.task.id);
    } else {
      budget.pause = budget.globalUsed >= budget.globalAllowance ? "global_limit"
        : evaluation.health === "unknown" ? "unknown" : "unhealthy";
      budget.resuming = false;
      budgetPauseText = budgetPauseMessage(input.session, evaluation.reason);
      input.session.addMessage({ role: "assistant", visible: true, pipeline: "budget", timestamp: Date.now(),
        content: budgetPauseText });
    }
    this.report(BusEvents.Element.Data, { step: "window-result", taskId: input.task.id, evaluation, before, after: structuredClone(budget) });
    return { type: PipelineResultType.Complete, task: input.task, output: `evaluator: ${evaluation.health}`, budgetPauseText, budgetBefore: before } as PipelineResult;
  }
}
