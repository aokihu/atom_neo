import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { BusEvents } from "@atom-neo/shared";
import type { CompressFlowState } from "./types";

const SUMMARIZE_PROMPT = `将以下对话历史总结为 500 字以内的摘要，保留关键信息、决策和进展。`;

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
      return { ...input, mode: "finalizing", summary: "" };
    }

    try {
      const provider = createDeepSeek({ apiKey: this.#apiKey, baseURL: this.#baseUrl });
      const model = provider(this.#model);

      const result = await generateText({
        model,
        system: SUMMARIZE_PROMPT,
        prompt: input.summaryText,
        maxTokens: 600,
        temperature: 0,
      });

      const summary = result.text.trim();
      this.report(BusEvents.Element.Data, { step: "generated", summaryLen: summary.length });
      return { ...input, mode: "finalizing", summary };
    } catch (err: any) {
      this.report(BusEvents.Element.Data, { step: "error", level: "warn", error: err.message });
      return { ...input, mode: "finalizing", summary: "" };
    }
  }
}
