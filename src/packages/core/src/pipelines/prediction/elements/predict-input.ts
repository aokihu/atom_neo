import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { PredictionFlowState } from "./types";
import { isPromptEligibleMessage } from "../../../session/message-policy";

const MAX_USER_MESSAGES = 5;
const MAX_ASSISTANT_REFERENCES = 3;
const MAX_USER_LEN = 400;
const MAX_ASSISTANT_LEN = 120;

export function buildPredictionContext(session: any, currentUserMessage: string) {
  const messages: Array<{ role: string; content: string; visible?: boolean }> = session?.messages ?? [];
  const visible = messages.filter(message => isPromptEligibleMessage(message as any));
  const users = visible.filter(message => message.role === "user");
  if (users.at(-1)?.content?.trim() === currentUserMessage) users.pop();
  return {
    userContextMessages: users
      .slice(-MAX_USER_MESSAGES)
      .map(message => (message.content ?? "").slice(0, MAX_USER_LEN))
      .join("\n"),
    assistantReference: visible
      .filter(message => message.role === "assistant")
      .slice(-MAX_ASSISTANT_REFERENCES)
      .map(message => (message.content ?? "").slice(0, MAX_ASSISTANT_LEN))
      .join("\n"),
  };
}

export class PredictInputElement extends BaseElement<any, PredictionFlowState> {
  #session: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    session: any;
    task: any;
  }) {
    super({ name: params.name, kind: "source", bus: params.bus });
    this.#session = params.session;
  }

  async doProcess(input: any): Promise<PredictionFlowState> {
    const task = input.task;
    const raw = task?.payload?.[0]?.data ?? "";
    const text = typeof raw === "string" ? raw.trim() : "";

    if (!text && this.#session?.messages) {
      const msgs = this.#session.messages;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "user") {
          this.report(BusEvents.Element.Data, { step: "done", userMsgLen: msgs[i].content?.trim().length ?? 0 });
          const userMessage = msgs[i].content?.trim() ?? "";
          return {
            mode: "predicting",
            task,
            session: this.#session,
            userMessage,
            ...buildPredictionContext(this.#session, userMessage),
          };
        }
      }
    }

    this.report(BusEvents.Element.Data, { step: "done", userMsgLen: text.length });
    return {
      mode: "predicting",
      task,
      session: this.#session,
      userMessage: text,
      ...buildPredictionContext(this.#session, text),
    };
  }
}
