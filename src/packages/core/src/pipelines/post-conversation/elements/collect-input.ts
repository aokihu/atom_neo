import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { PostConversationFlowState } from "./types";

export class CollectInputElement extends BaseElement<PostConversationFlowState, PostConversationFlowState> {
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

  async doProcess(_input: PostConversationFlowState): Promise<PostConversationFlowState> {
    const msgs: Array<{ role: string; content: string }> = this.#session?.messages ?? [];
    const prediction = this.#session?.pendingPrediction ?? {};

    const assistantMsg = [...msgs].reverse().find(m => m.role === "assistant");
    const userMsg = [...msgs].reverse().find(m => m.role === "user");

    this.report(BusEvents.Element.Data, {
      step: "collected",
      hasUser: !!userMsg,
      hasAssistant: !!assistantMsg,
      toolTier: prediction.toolTier ?? "basic",
      taskIntent: prediction.taskIntent ?? "conversation",
    });

    return {
      mode: "analyzing",
      task: null,
      session: this.#session,
      userMessage: userMsg?.content ?? "",
      assistantResponse: assistantMsg?.content ?? "",
      predictedToolTier: prediction.toolTier ?? "basic",
      predictedTaskIntent: prediction.taskIntent ?? "conversation",
    };
  }
}
