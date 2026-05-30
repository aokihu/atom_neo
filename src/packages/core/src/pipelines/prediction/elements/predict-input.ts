import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { PredictionFlowState } from "./types";

const MAX_CONTEXT_PAIRS = 5;
const MAX_MSG_LEN = 200;

function buildContext(session: any): string {
  if (!session?.messages?.length) return "";
  const msgs: Array<{ role: string; content: string }> = session.messages;
  const recent = msgs.slice(-MAX_CONTEXT_PAIRS * 2);
  return recent
    .filter(m => m.role === "user" || m.role === "assistant")
    .slice(0, 10)
    .map(m => `${m.role}: ${(m.content ?? "").slice(0, MAX_MSG_LEN)}`)
    .join("\n");
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
          return {
            mode: "predicting",
            task,
            session: this.#session,
            userMessage: msgs[i].content?.trim() ?? "",
            contextMessages: buildContext(this.#session),
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
      contextMessages: buildContext(this.#session),
    };
  }
}
