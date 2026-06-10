import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_MAX_TOKENS } from "../../../constants";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import type { ConversationFlowState } from "./types";

export class FinalizeElement extends BaseElement<ConversationFlowState, any> {
  #orchestrator?: InternalTaskOrchestrator;
  #session: any;
  #configContextLimit: number;
  #maxTokens: number;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator?: InternalTaskOrchestrator;
    session?: any;
    configContextLimit?: number;
    maxTokens?: number;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#session = params.session;
    this.#configContextLimit = params.configContextLimit ?? DEFAULT_CONTEXT_LIMIT;
    this.#maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async doProcess(input: ConversationFlowState): Promise<any> {
    if (input.mode !== "ready_to_finalize") {
      throw new Error("FinalizeElement: expected ready_to_finalize");
    }

    if (input.tokenOverflow) {
      return this.#handleOverflow(input);
    }

    this.#session.compressRetry = 0;
    this.#session.compressRatio = 0;

    if (!input.chainAction) {
      this.report(BusEvents.Element.Data, { step: "complete", chainAction: "none" });
      this.report(BusEvents.Conversation.Idle, {
        sessionId: input.task.sessionId,
        chatId: input.task.chatId,
        parentTaskId: input.task.parentTaskId ?? input.task.id,
      });
      return this.#complete(input);
    }

    this.report(BusEvents.Element.Data, { step: "scheduling chain", chainAction: input.chainAction });
    this.report(BusEvents.Conversation.Chain, {
      sessionId: input.task.sessionId,
      chatId: input.task.chatId,
      parentTaskId: input.task.parentTaskId ?? input.task.id,
      action: input.chainAction,
    });
    return this.#complete(input);
  }

  #handleOverflow(input: ConversationFlowState) {
    if (!this.#orchestrator || this.#session?.compressing) {
      return this.#complete(input);
    }

    const tu = this.#session?.tokenUsage?.total ?? 0;
    const effectiveLimit = this.#configContextLimit - this.#maxTokens;

    if (this.#session.compressRetry === 0) {
      this.#session.compressRatio = Math.max(0, (tu / effectiveLimit - 0.8) * 5);
    }
    this.#session.compressRetry++;
    if (this.#session.compressRetry > 1) {
      this.#session.compressRatio = Math.min(2.0, this.#session.compressRatio + 0.4);
    }
    this.#session.compressing = true;

    this.report(BusEvents.Element.Data, {
      step: "token-overflow, scheduling compress",
      compressRetry: this.#session.compressRetry,
      compressRatio: this.#session.compressRatio.toFixed(2),
      tu, effectiveLimit,
    });

    this.#orchestrator.scheduleCompress(
      input.task.sessionId,
      input.task.chatId,
      input.task.parentTaskId ?? input.task.id,
    );
    return this.#complete(input);
  }

  #complete(input: ConversationFlowState) {
    return {
      type: "complete" as const,
      task: input.task,
      output: input.responseText,
      reasoningContent: input.reasoningContent,
      tokenUsage: input.tokenUsage,
    };
  }
}
