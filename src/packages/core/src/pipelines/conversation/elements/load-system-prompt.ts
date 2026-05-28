import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";
import baseSystemPrompt from "@assets/prompts/base_system_prompt.md";

export class LoadSystemPromptElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;
    return { ...input, systemPrompt: baseSystemPrompt };
  }
}
