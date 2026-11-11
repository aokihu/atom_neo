import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, ProviderProtocol } from "@atom-neo/shared";
import { BusEvents, inferProviderProtocol, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type { IntentPredictionResult } from "@atom-neo/shared";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { PredictionFlowState } from "./types";
import { createLanguageModel, providerOptionsFor } from "../../shared/model-provider";

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

export function buildPredictionEnvelope(input: PredictionFlowState): Record<string, unknown> {
  return {
    userInput: input.userMessage,
    currentTopic: input.currentTopic || "",
    ...(input.previousTurnContext ? { previousTurnContext: input.previousTurnContext } : {}),
  };
}

export class PredictIntentElement extends BaseElement<PredictionFlowState, PredictionFlowState> {
  #apiKey: string;
  #model: string;
  #provider: string;
  #protocol: ProviderProtocol;
  #baseUrl?: string;
  #thinking?: string;
  #options?: Record<string, unknown>;
  #maxTokens: number;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    apiKey: string;
    model: string;
    provider?: string;
    protocol?: ProviderProtocol;
    baseUrl?: string;
    thinking?: string;
    options?: Record<string, unknown>;
    maxTokens?: number;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#apiKey = params.apiKey;
    this.#model = params.model;
    this.#provider = params.provider ?? "deepseek";
    this.#protocol = params.protocol ?? inferProviderProtocol(this.#provider);
    this.#baseUrl = params.baseUrl;
    this.#thinking = params.thinking;
    this.#options = params.options;
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
      const model = createLanguageModel({
        provider: this.#provider,
        protocol: this.#protocol,
        apiKey: this.#apiKey,
        model: this.#model,
        baseUrl: this.#baseUrl,
      });
      const result = await generateText({
        model,
        instructions: resolvePrompt(PromptKey.PREDICT_INTENT, `${this.#provider}/${this.#model}`),
        prompt: JSON.stringify(buildPredictionEnvelope(input)),
        output: Output.object({ schema: IntentPredictionSchema }),
        maxOutputTokens: this.#maxTokens,
        temperature: 0,
        providerOptions: providerOptionsFor({
          protocol: this.#protocol,
          thinking: this.#thinking,
          options: this.#options,
        }),
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
