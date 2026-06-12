import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_MAX_TOKENS } from "../../constants";

export function calcTokenUsage(total: number, inputUsage?: { total?: number }): number {
  return total + (inputUsage?.total ?? 0);
}

export function calcTokenRatio(
  tu: number,
  configContextLimit: number = DEFAULT_CONTEXT_LIMIT,
  maxTokens: number = DEFAULT_MAX_TOKENS,
): number {
  const effectiveLimit = configContextLimit - maxTokens;
  return effectiveLimit > 0 ? tu / effectiveLimit : 0;
}

export function applyCompressRatio(session: any, usageRatio: number): void {
  if (session.compressRetry === 0) {
    session.compressRatio = Math.max(0, (usageRatio - 0.8) * 5);
  }
  session.compressRetry++;
  if (session.compressRetry > 1) {
    session.compressRatio = Math.min(2.0, session.compressRatio + 0.4);
  }
  session.compressing = true;
}

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
    const tu = calcTokenUsage(this.#session?.tokenUsage?.total ?? 0, input);
    const ratio = calcTokenRatio(tu, this.#configContextLimit, this.#maxTokens);

    this.report(BusEvents.Element.Data, {
      step: "token-ratio",
      tu,
      effectiveLimit: this.#configContextLimit - this.#maxTokens,
      ratio: +ratio.toFixed(4),
    });

    return input;
  }
}
