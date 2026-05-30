import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";

export class FetchAgentsPromptElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #getCompiledPrompt: () => string;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    getCompiledPrompt: () => string;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#getCompiledPrompt = params.getCompiledPrompt;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;
    const compiled = this.#getCompiledPrompt();
    this.report(BusEvents.Element.Data, { step: "done", hasCompiled: !!compiled });
    if (!compiled) return input;
    return { ...input, compiledAgentsPrompt: compiled };
  }
}
