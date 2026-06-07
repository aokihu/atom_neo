import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";

export class LoadSystemPromptElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #providerModel: string;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    providerModel?: string;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#providerModel = params.providerModel ?? "deepseek/deepseek-v4-pro";
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;
    const prompt = resolvePrompt(PromptKey.BASE_SYSTEM, this.#providerModel);
    this.report(BusEvents.Element.Data, { step: "done", promptLen: prompt.length });
    return { ...input, systemPrompt: prompt };
  }
}
