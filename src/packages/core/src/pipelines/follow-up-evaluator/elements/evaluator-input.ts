import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import type { EvaluatorFlowState } from "./types";

const MAX_MESSAGES = 10;
const MAX_MSG_LEN = 200;

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
      .map(m => `${m.role}: ${(m.content ?? "").slice(0, MAX_MSG_LEN)}`)
      .join("\n");

    return {
      mode: "analyzing",
      task,
      session: this.#session,
      recentSummary: summary,
    };
  }
}
