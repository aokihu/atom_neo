import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import { BusEvents, PipelineResultType, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_MAX_TOKENS } from "../../../constants";
import type { EvaluatorFlowState } from "./types";
import { FALLBACK_EVALUATOR } from "./types";
import { calcTokenRatio, applyCompressRatio } from "../../shared";
import type { ContextService } from "../../../context/context-service";

export class EvaluateFinalizeElement extends BaseElement<EvaluatorFlowState, PipelineResult> {
  #orchestrator: InternalTaskOrchestrator;
  #configContextLimit: number;
  #maxTokens: number;
  #contextService: ContextService;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator;
    configContextLimit?: number;
    maxTokens?: number;
    contextService: ContextService;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#configContextLimit = params.configContextLimit ?? DEFAULT_CONTEXT_LIMIT;
    this.#maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.#contextService = params.contextService;
  }

  async doProcess(input: EvaluatorFlowState): Promise<PipelineResult> {
    const { health, suggestion, upgradeModel, reason } = input.evaluation ?? FALLBACK_EVALUATOR;

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
      return { type: PipelineResultType.Complete, task: input.task, output: `evaluator: stuck — ${reason}` };
    }

    const owner = {
      sessionId: input.session.sessionId,
      ...(input.session.currentTopic ? { topicId: input.session.currentTopic } : {}),
    };
    const scope = input.session.currentTopic ? "topic" as const : "session" as const;
    if (health !== "healthy" && suggestion) {
      this.#contextService.put({
        scope,
        owner,
        entry: {
          key: "evaluator-suggestion",
          source: "follow-up-evaluator",
          channel: "instructions",
          trust: "trusted",
          priority: 850,
          consumeOnCommit: true,
          content: resolvePrompt(PromptKey.CONTEXT_EVALUATOR_HINT).replace("%s", suggestion),
        },
      });
    } else {
      this.#contextService.remove(scope, owner, "evaluator-suggestion");
    }
    if (health !== "healthy" && upgradeModel) {
      this.#contextService.put({
        scope,
        owner,
        entry: {
          key: "model-upgrade",
          source: "follow-up-evaluator",
          channel: "instructions",
          trust: "trusted",
          priority: 840,
          consumeOnCommit: true,
          content: resolvePrompt(PromptKey.CONTEXT_MODEL_UPGRADE),
        },
      });
    } else {
      this.#contextService.remove(scope, owner, "model-upgrade");
    }

    const tu = input.session?.contextTokens ?? 0;
    const ratio = calcTokenRatio(tu, this.#configContextLimit, this.#maxTokens);
    const effectiveLimit = (this.#configContextLimit ?? DEFAULT_CONTEXT_LIMIT) - this.#maxTokens;
    if (tu > effectiveLimit * 0.8) {
      if (input.session.compressing) {
        this.report(BusEvents.Element.Data, { step: "compress already in progress, skipping" });
        return { type: PipelineResultType.Complete, task: input.task, output: `evaluator: compress already in progress` };
      }

      applyCompressRatio(input.session, ratio);

      this.report(BusEvents.Element.Data, {
        step: "token usage high, scheduling compress",
        trigger: "context-pressure",
        target: "context+messages",
        resumeConversation: true,
        total: tu, effectiveLimit,
        compressRetry: input.session.compressRetry,
        compressRatio: input.session.compressRatio.toFixed(3),
      });
      this.#orchestrator.scheduleCompress(
        input.session.sessionId,
        input.task.chatId,
        input.task.parentTaskId ?? input.task.id,
        { trigger: "context-pressure", resumeConversation: true },
        input.task.id,
      );
      return { type: PipelineResultType.Complete, task: input.task, output: `evaluator: health=${health}, compress scheduled` };
    }

    this.#orchestrator.scheduleConversation(
      input.session.sessionId,
      input.task.chatId,
      input.task.parentTaskId ?? input.task.id,
      undefined,
      undefined,
      input.task.id,
    );

    return {
      type: PipelineResultType.Complete,
      task: input.task,
      output: `evaluator: health=${health}`,
    };
  }
}
