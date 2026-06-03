import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";

export class FinalizeElement extends BaseElement<ConversationFlowState, any> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<any> {
    if (input.mode !== "ready_to_finalize") {
      throw new Error("FinalizeElement: expected ready_to_finalize");
    }

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
