import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_MAX_TOKENS } from "../../constants";

export class TokenRatioElement extends BaseElement<any, any> {
  #session: any;
  #configContextLimit: number;
  #maxTokens: number;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    session?: any;
    configContextLimit?: number;
    maxTokens?: number;
  }) {
    super({ name: params.name, kind: "boundary", bus: params.bus });
    this.#session = params.session;
    this.#configContextLimit = params.configContextLimit ?? DEFAULT_CONTEXT_LIMIT;
    this.#maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async doProcess(input: any): Promise<any> {
    const tu = (this.#session?.tokenUsage?.total ?? 0) + (input.tokenUsage?.total ?? 0);
    const effectiveLimit = this.#configContextLimit - this.#maxTokens;
    const ratio = effectiveLimit > 0 ? tu / effectiveLimit : 0;

    this.report(BusEvents.Element.Data, {
      step: "token-ratio",
      tu,
      effectiveLimit,
      ratio: +ratio.toFixed(4),
    });

    return input;
  }
}
