import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { PredictionFlowState } from "./types";

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
    const text = typeof raw === "string" ? raw : "";

    this.report(BusEvents.Element.Data, { step: "done", userMsgLen: text.length });
    return {
      mode: "predicting",
      task,
      session: this.#session,
      userMessage: text,
    };
  }
}
