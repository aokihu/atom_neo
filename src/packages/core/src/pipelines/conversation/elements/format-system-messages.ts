import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";

export class FormatSystemMessagesElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;

    const parts: string[] = [];
    if (input.systemPrompt) parts.push(input.systemPrompt);
    if (input.compiledAgentsPrompt) parts.push(input.compiledAgentsPrompt);
    if (input.contextData) parts.push(input.contextData);

    this.report(BusEvents.Element.Data, { step: "done", systemLen: input.systemPrompt?.length ?? 0, agentsLen: input.compiledAgentsPrompt?.length ?? 0, contextLen: input.contextData?.length ?? 0 });
    return { ...input, systemText: parts.join("\n\n") };
  }
}
