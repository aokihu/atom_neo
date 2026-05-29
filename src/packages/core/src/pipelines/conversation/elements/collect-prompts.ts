import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";

export class CollectPromptsElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #session: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    session: any;
  }) {
    super({ name: params.name, kind: "source", bus: params.bus });
    this.#session = params.session;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "initial") return input;

    const messages = (this.#session.messages ?? [])
      .filter((m: any) => m.visible !== false)
      .map((m: any) => {
        const msg: any = { role: m.role, content: m.content };
        if (m.reasoningContent) msg.reasoning_content = m.reasoningContent;
        return msg;
      });

    return { mode: "streaming", task: input.task, prompts: messages };
  }
}
