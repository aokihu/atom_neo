import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { BusEvents, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type { EvaluatorFlowState, EvaluatorResult } from "./types";

const FALLBACK: EvaluatorResult = {
  health: "healthy",
  suggestion: "",
  upgradeModel: false,
  reason: "analysis skipped, continuing",
};

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
      return { ...input, mode: "intervening", evaluation: FALLBACK };
    }

    if (!this.#apiKey) {
      this.report(BusEvents.Element.Data, { step: "no apiKey, fallback to healthy" });
      return { ...input, mode: "intervening", evaluation: FALLBACK };
    }

    try {
      const provider = createDeepSeek({ apiKey: this.#apiKey, baseURL: this.#baseUrl });
      const model = provider(this.#model);

      const prompt = `Recent conversation:\n${input.recentSummary}`;
      this.report(BusEvents.Element.Data, { step: "classifying", summaryLen: input.recentSummary.length, promptPreview: prompt.slice(0, 200) });

      const result = await generateText({
        model,
        system: resolvePrompt(PromptKey.EVALUATOR_ANALYZE),
        prompt,
        maxTokens: this.#maxTokens,
        temperature: 0,
      });

      const raw = result.text.trim();
      this.report(BusEvents.Element.Data, { step: "LLM response", raw: raw.slice(0, 500) });

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.report(BusEvents.Element.Data, { step: "no JSON in response, fallback", level: "warn" });
        return { ...input, mode: "intervening", evaluation: FALLBACK };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const evaluation = {
        health: ["healthy", "looping", "stuck", "degrading"].includes(parsed.health)
          ? parsed.health : "healthy",
        suggestion: parsed.suggestion ?? "",
        upgradeModel: parsed.upgradeModel === true,
        reason: parsed.reason ?? "",
      };

      this.report(BusEvents.Element.Data, { step: "classified", evaluation });
      return { ...input, mode: "intervening", evaluation };
    } catch (err: any) {
      this.report(BusEvents.Element.Data, { step: "error, fallback", level: "warn", error: err.message });
      return { ...input, mode: "intervening", evaluation: FALLBACK };
    }
  }

  static getPrompt(summary: string): string {
    return `Recent conversation:\n${summary}`;
  }
}
