import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { EvaluatorFlowState } from "./types";

const MAX_MESSAGES = 10;
const MAX_USER_LEN = 300;
const MAX_ASSISTANT_LEN = 120;

export class EvaluatorInputElement extends BaseElement<any, EvaluatorFlowState> {
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

  async doProcess(input: any): Promise<EvaluatorFlowState> {
    const task = input.task;
    const msgs: Array<{ role: string; content: string }> = this.#session?.messages ?? [];
    const recent = msgs.slice(-MAX_MESSAGES);
    const summary = recent
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => m.role === "user"
        ? `user_goal: ${(m.content ?? "").slice(0, MAX_USER_LEN)}`
        : `assistant_reference_unverified: ${(m.content ?? "").slice(0, MAX_ASSISTANT_LEN)}`)
      .join("\n");

    this.report(BusEvents.Element.Data, { step: "done", msgCount: msgs.length, summaryLen: summary.length });
    return {
      mode: "analyzing",
      task,
      session: this.#session,
      recentSummary: summary,
    };
  }
}
