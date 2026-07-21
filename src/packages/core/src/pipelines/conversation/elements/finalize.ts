import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents, TaskFailureCodes } from "@atom-neo/shared";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_MAX_TOKENS } from "../../../constants";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import type { ConversationFlowState } from "./types";
import { calcTokenRatio, applyCompressRatio } from "../../shared";

export class ApiKeyInvalidError extends Error {
  readonly code = TaskFailureCodes.ApiKeyInvalid;

  constructor() {
    super("The configured API key was rejected by the model provider");
    this.name = "ApiKeyInvalidError";
  }
}

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

    this.#completeSnapshot(input);

    if (input.errorStatusCode === 401) {
      this.report(BusEvents.Element.Data, { step: "api-key-invalid", errorStatusCode: 401 });
      throw new ApiKeyInvalidError();
    }

    if (input.tokenOverflow) {
      return this.#handleOverflow(input);
    }

    this.#session.compressRetry = 0;
    this.#session.compressRatio = 0;

    if (!input.chainAction) {
      this.report(BusEvents.Element.Data, { step: "complete", chainAction: "none" });
      if (input.errorStatusCode && input.errorStatusCode >= 400) {
        this.report(BusEvents.Element.Data, { step: "skip post-check, non-recoverable error", errorStatusCode: input.errorStatusCode });
        return this.#complete(input);
      }
      return this.#complete(input, true);
    }

    this.report(BusEvents.Element.Data, { step: "defer chain until task completed", chainAction: input.chainAction });
    return this.#complete(input);
  }

  #handleOverflow(input: ConversationFlowState) {
    if (!this.#orchestrator || this.#session?.compressing) {
      return this.#complete(input);
    }

    const tu = this.#session?.contextTokens ?? 0;
    const ratio = calcTokenRatio(tu, this.#configContextLimit, this.#maxTokens);
    const effectiveLimit = this.#configContextLimit - this.#maxTokens;

    applyCompressRatio(this.#session, ratio);

    this.report(BusEvents.Element.Data, {
      step: "token-overflow, scheduling compress",
      trigger: "token-overflow",
      target: "context+messages",
      resumeConversation: true,
      compressRetry: this.#session.compressRetry,
      compressRatio: this.#session.compressRatio.toFixed(2),
      tu, effectiveLimit,
    });

    this.#orchestrator.scheduleCompress(
      input.task.sessionId,
      input.task.chatId,
      input.task.parentTaskId ?? input.task.id,
      { trigger: "token-overflow", resumeConversation: true },
      input.task.id,
    );
    return this.#complete({ ...input, chainAction: undefined });
  }

  #complete(input: ConversationFlowState, shouldPostCheck = false) {
    return {
      type: "complete" as const,
      task: input.task,
      output: input.responseText,
      reasoningContent: input.reasoningContent,
      tokenUsage: input.tokenUsage,
      chainAction: input.chainAction,
      shouldPostCheck,
      finishReason: input.finishReason,
      completeDetected: input.completeDetected,
    };
  }

  #completeSnapshot(input: ConversationFlowState): void {
    if (!input.contextSnapshot) return;
    const event = input.contextSnapshotAccepted && !input.tokenOverflow
      ? BusEvents.Context.SnapshotCommit
      : BusEvents.Context.SnapshotRelease;
    this.bus.emit(event as any, { snapshotId: input.contextSnapshot.id } as any);
    this.report(BusEvents.Element.Data, {
      step: event === BusEvents.Context.SnapshotCommit ? "snapshot-committed" : "snapshot-released",
      snapshotId: input.contextSnapshot.id,
    });
  }
}
