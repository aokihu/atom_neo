import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type { IntentPredictionResult } from "@atom-neo/shared";
import { generateText, Output } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { z } from "zod";
import type { PredictionFlowState } from "./types";

const FALLBACK: IntentPredictionResult = {
  difficulty: "medium",
  modelProfile: "balanced",
  intent: "conversation",
  contextRelevance: "standalone",
  topic: "",
  reasoning: "prediction skipped or failed, fallback to defaults",
};

export const IntentPredictionSchema = z.object({
  difficulty: z.enum(["easy", "medium", "hard", "mygod"]),
  modelProfile: z.enum(["basic", "balanced", "advanced"]),
  intent: z.enum(["instruction", "question", "creative", "conversation"]),
  contextRelevance: z.enum(["standalone", "follow_up", "continuation"]),
  topic: z.string(),
  reasoning: z.string(),
});

export class PredictIntentElement extends BaseElement<PredictionFlowState, PredictionFlowState> {
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

  async doProcess(input: PredictionFlowState): Promise<PredictionFlowState> {
    if (input.mode !== "predicting") return input;

    const text = input.userMessage;
    if (!text) {
      this.report(BusEvents.Element.Data, { step: "empty input, fallback" });
      return { ...input, mode: "routing", prediction: FALLBACK };
    }

    if (!this.#apiKey) {
      this.report(BusEvents.Element.Data, { step: "no apiKey, fallback" });
      return { ...input, mode: "routing", prediction: FALLBACK };
    }

    try {
      this.report(BusEvents.Element.Data, { step: "classifying", userMsgLen: text.length });
      const provider = createDeepSeek({ apiKey: this.#apiKey, baseURL: this.#baseUrl });
      const result = await generateText({
        model: provider(this.#model),
        instructions: resolvePrompt(PromptKey.PREDICT_INTENT),
        prompt: JSON.stringify({ userInput: text }),
        output: Output.object({ schema: IntentPredictionSchema }),
        maxOutputTokens: this.#maxTokens,
        temperature: 0,
        abortSignal: input.abortSignal,
      });
      const prediction = result.output;
      this.report(BusEvents.Element.Data, { step: "done", ...prediction });
      return { ...input, mode: "routing", prediction };
    } catch (err: any) {
      this.report(BusEvents.Element.Data, { step: "error, fallback", error: err?.message });
      return { ...input, mode: "routing", prediction: FALLBACK };
    }
  }
}
