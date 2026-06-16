import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { ConversationFlowState, Message } from "./types";

export class FormatUserMessagesElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const messages: Message[] = [];
    for (const m of input.prompts ?? []) {
      if (m.role === "tool") continue;
      messages.push({ role: m.role, content: m.content });
    }
    const text = input.task?.payload?.[0]?.data;
    if (text) messages.push({ role: "user" as const, content: text });

    this.report(BusEvents.Element.Data, { step: "done", messageCount: messages.length });
    return { ...input, mode: "formatted", userMessages: messages };
  }
}
