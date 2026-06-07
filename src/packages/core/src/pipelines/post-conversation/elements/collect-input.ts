import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents, PromptKey, resolvePrompt } from "@atom-neo/shared";
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

    const lastUserIdx = [...msgs].reduce((idx, m, i) => m.role === "user" ? i : idx, -1);

    const MAX_PART_CHARS = 1500;
    const parts: string[] = [];
    for (let i = lastUserIdx + 1; i < msgs.length; i++) {
      if (msgs[i].role === "user") break;
      if (msgs[i].role === "assistant" && msgs[i].content) {
        const content = msgs[i].content;
        parts.push(content.length > MAX_PART_CHARS
          ? content.slice(0, MAX_PART_CHARS) + resolvePrompt(PromptKey.TRUNCATION_MARKER).replace("%d", String(content.length))
          : content);
      }
    }
    const assistantResponse = parts.join("\n");
    const userMessage = msgs[lastUserIdx]?.content ?? "";

    this.report(BusEvents.Element.Data, {
      step: "collected",
      hasUser: !!userMessage,
      hasAssistant: parts.length > 0,
      assistantParts: parts.length,
      taskIntent: prediction.taskIntent ?? "conversation",
    });

    return {
      mode: "analyzing",
      task: null,
      session: this.#session,
      userMessage,
      assistantResponse,
      predictedTaskIntent: prediction.taskIntent ?? "conversation",
      stepCount: prediction.stepCount ?? 0,
      assistantParts: parts.length,
    };
  }
}
