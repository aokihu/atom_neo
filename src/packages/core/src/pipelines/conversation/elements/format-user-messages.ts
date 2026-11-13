import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import { appendCurrentUserMessage, projectPipelineMessage } from "@core/session/message-projection";
import type { ConversationFlowState } from "./types";

export class FormatUserMessagesElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const [first] = input.task?.payload ?? [];
    const messages = appendCurrentUserMessage(
      (input.prompts ?? [])
        .filter(message => message.role !== "tool")
        .map(message => projectPipelineMessage(message, { keepReasoning: false })),
      first?.type === "text" ? first.data : undefined,
    );

    this.report(BusEvents.Element.Data, { step: "done", messageCount: messages.length });
    return { ...input, mode: "formatted", userMessages: messages };
  }
}
