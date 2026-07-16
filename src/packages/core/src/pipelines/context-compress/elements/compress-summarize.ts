import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents, PromptKey, substringWellFormed } from "@atom-neo/shared";
import type { CompressFlowState } from "./types";
import { callLLM } from "../../shared";

export class CompressSummarizeElement extends BaseElement<CompressFlowState, CompressFlowState> {
  #apiKey: string;
  #model: string;
  #baseUrl?: string;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    apiKey: string;
    model: string;
    baseUrl?: string;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#apiKey = params.apiKey;
    this.#model = params.model;
    this.#baseUrl = params.baseUrl;
  }

  async doProcess(input: CompressFlowState): Promise<CompressFlowState> {
    if (input.mode !== "summarizing") return input;

    if (!input.summaryText || !this.#apiKey) {
      this.report(BusEvents.Element.Data, { step: "skipping, no text or apiKey" });
      return {
        ...input,
        mode: "finalizing",
        summary: "",
        ...(input.summaryText ? { summaryError: "summary model unavailable" } : {}),
      };
    }

    try {
      const summary = await callLLM({
        apiKey: this.#apiKey,
        model: this.#model,
        baseUrl: this.#baseUrl,
        systemKey: PromptKey.COMPRESS_SUMMARIZE,
        prompt: input.summaryText,
        maxTokens: input.summaryMaxTokens || 600,
      });
      const summaryError = summary.trim() ? undefined : "summary model returned empty text";
      this.report(BusEvents.Element.Data, { step: "generated", summaryLen: summary.length });
      return { ...input, mode: "finalizing", summary, ...(summaryError ? { summaryError } : {}) };
    } catch (err: any) {
      input.session.compressRatio = Math.min(2.0, (input.session.compressRatio ?? 0.5) + 0.4);
      this.report(BusEvents.Element.Data, {
        step: "error",
        level: "warn",
        error: substringWellFormed(err.message ?? "", 0, 300),
        errorName: err.name,
        statusCode: err.statusCode,
        responseBody: substringWellFormed(err.responseBody ?? "", 0, 300),
      });
      return { ...input, mode: "finalizing", summary: "", summaryError: err.message ?? "summary failed" };
    }
  }
}
