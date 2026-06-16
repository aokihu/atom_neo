import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";

export class CollectPromptsElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #session: any;
  #contextRelevance: string;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    session: any;
    contextRelevance?: string;
  }) {
    super({ name: params.name, kind: "source", bus: params.bus });
    this.#session = params.session;
    this.#contextRelevance = params.contextRelevance ?? "follow_up";
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "initial") return input;

    const allMsgs = this.#session.messages ?? [];
    this.report(BusEvents.Element.Data, { step: "session-state", totalMsgs: allMsgs.length, visibleMsgs: allMsgs.filter((m: any) => m.visible !== false).length, contextRelevance: this.#contextRelevance });

    const visibleMsgs = allMsgs.filter((m: any) => m.visible !== false);
    const limitedMsgs = this.#contextRelevance === "standalone" ? visibleMsgs.slice(-2) : visibleMsgs;

    const messages = limitedMsgs.map((m: any) => {
      const msg: any = { role: m.role, content: m.content };
      if (m.reasoningContent) msg.reasoning_content = m.reasoningContent;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      return msg;
    });

    this.report(BusEvents.Element.Data, { step: "done", messageCount: messages.length });
    return { mode: "streaming", task: input.task, prompts: messages };
  }
}
