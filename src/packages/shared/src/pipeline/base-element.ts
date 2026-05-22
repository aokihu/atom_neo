import type { PipelineElementKind } from "./types";
import type { PipelineEventBus } from "./event-bus";
import type { PipelineEventMap } from "../types/pipeline";

export abstract class BaseElement<I = any, O = any> {
  readonly name: string;
  readonly kind: PipelineElementKind;
  protected readonly bus: PipelineEventBus<PipelineEventMap>;

  #state: "READY" | "WORKING" | "DONE" | "FAILED" = "READY";

  constructor(params: {
    name: string;
    kind: PipelineElementKind;
    bus: PipelineEventBus<PipelineEventMap>;
  }) {
    this.name = params.name;
    this.kind = params.kind;
    this.bus = params.bus;
    this.#reportState("READY");
  }

  async process(input: I): Promise<O> {
    this.#reportState("WORKING");
    try {
      const result = await this.doProcess(input);
      this.#reportState("DONE");
      return result;
    } catch (error) {
      this.#reportState("FAILED");
      throw error;
    }
  }

  protected abstract doProcess(input: I): Promise<O>;

  protected report(eventName: string, payload: Record<string, unknown>): void {
    this.bus.emit(eventName as any, {
      name: this.name,
      payload,
    } as any);
  }

  #reportState(state: string): void {
    this.#state = state as any;
    this.bus.emit("element.state-changed", {
      name: this.name,
      payload: { state: state as any },
    });
  }
}
