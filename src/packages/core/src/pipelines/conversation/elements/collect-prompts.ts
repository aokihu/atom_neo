import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";
import { projectPipelineMessage, selectPromptEligibleMessages } from "@core/session/message-projection";
import type { PipelineSession } from "@core/session/element-session";

export function selectPromptMessages<T extends { role: string }>(
  messages: readonly T[],
  contextRelevance: string,
): T[] {
  if (contextRelevance === "standalone") {
    const currentUser = [...messages].reverse().find(message => message.role === "user");
    return currentUser ? [currentUser] : [];
  }
  if (contextRelevance === "follow_up") return messages.slice(-3);
  return [...messages];
}

export class CollectPromptsElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #session: PipelineSession;
  #contextRelevance: string;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    session: PipelineSession;
    contextRelevance?: string;
  }) {
    super({ name: params.name, kind: "source", bus: params.bus });
    this.#session = params.session;
    this.#contextRelevance = params.contextRelevance ?? "follow_up";
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "initial") return input;

    const allMsgs = this.#session.messages ?? [];
    const visibleMsgs = selectPromptEligibleMessages(allMsgs);
    this.report(BusEvents.Element.Data, { step: "session-state", totalMsgs: allMsgs.length, visibleMsgs: visibleMsgs.length, contextRelevance: this.#contextRelevance });
    const limitedMsgs = selectPromptMessages(visibleMsgs, this.#contextRelevance);

    const messages = limitedMsgs.map(message => projectPipelineMessage(message));

    this.report(BusEvents.Element.Data, { step: "done", messageCount: messages.length });
    return { mode: "streaming", task: input.task, prompts: messages };
  }
}
