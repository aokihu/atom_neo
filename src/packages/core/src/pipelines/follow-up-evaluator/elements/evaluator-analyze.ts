import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents, PromptKey } from "@atom-neo/shared";
import type { EvaluatorFlowState, EvaluatorResult } from "./types";
import { FALLBACK_EVALUATOR } from "./types";
import { callLLM, parseJsonFromLLMResponse } from "../../shared";

export class EvaluatorAnalyzeElement extends BaseElement<EvaluatorFlowState, EvaluatorFlowState> {
  #apiKey: string;
  #model: string;
  #baseUrl?: string;
  #maxTokens: number;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    apiKey: string;
    model: string;
    baseUrl?: string;
    maxTokens?: number;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#apiKey = params.apiKey;
    this.#model = params.model;
    this.#baseUrl = params.baseUrl;
    this.#maxTokens = params.maxTokens ?? 512;
  }

  async doProcess(input: EvaluatorFlowState): Promise<EvaluatorFlowState> {
    if (input.mode !== "analyzing") return input;

    if (!input.recentSummary) {
      this.report(BusEvents.Element.Data, { step: "empty summary, fallback to healthy" });
      return { ...input, mode: "intervening", evaluation: FALLBACK_EVALUATOR };
    }

    if (!this.#apiKey) {
      this.report(BusEvents.Element.Data, { step: "no apiKey, fallback to healthy" });
      return { ...input, mode: "intervening", evaluation: FALLBACK_EVALUATOR };
    }

    try {
      const prompt = `Recent conversation:\n${input.recentSummary}`;
      this.report(BusEvents.Element.Data, { step: "classifying", summaryLen: input.recentSummary.length, promptPreview: prompt.slice(0, 200) });

      const raw = await callLLM({
        apiKey: this.#apiKey,
        model: this.#model,
        baseUrl: this.#baseUrl,
        systemKey: PromptKey.EVALUATOR_ANALYZE,
        prompt,
        maxTokens: this.#maxTokens,
      });

      this.report(BusEvents.Element.Data, { step: "LLM response", raw: raw.slice(0, 500) });

      const parsed = parseJsonFromLLMResponse<Record<string, any>>(raw);
      if (!parsed) {
        this.report(BusEvents.Element.Data, { step: "no JSON in response, fallback", level: "warn" });
        return { ...input, mode: "intervening", evaluation: FALLBACK_EVALUATOR };
      }

      const evaluation: EvaluatorResult = {
        health: ["healthy", "looping", "stuck", "degrading"].includes(parsed.health as string)
          ? (parsed.health as EvaluatorResult["health"]) : "healthy",
        suggestion: (parsed.suggestion as string) ?? "",
        upgradeModel: parsed.upgradeModel === true,
        reason: (parsed.reason as string) ?? "",
      };

      this.report(BusEvents.Element.Data, { step: "classified", evaluation });
      return { ...input, mode: "intervening", evaluation };
    } catch (err: any) {
      this.report(BusEvents.Element.Data, { step: "error, fallback", level: "warn", error: err.message });
      return { ...input, mode: "intervening", evaluation: FALLBACK_EVALUATOR };
    }
  }

  static getPrompt(summary: string): string {
    return `Recent conversation:\n${summary}`;
  }
}
