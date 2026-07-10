import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents, PromptKey } from "@atom-neo/shared";
import type { IntentPredictionResult, DifficultyLevel, ModelProfile } from "@atom-neo/shared";
import type { PredictionFlowState } from "./types";
import { callLLM, parseJsonFromLLMResponse } from "../../shared";

const FALLBACK: IntentPredictionResult = {
  difficulty: "medium",
  modelProfile: "balanced",
  intent: "conversation",
  contextRelevance: "standalone",
  memoryQuery: "",
  topic: "",
  reasoning: "prediction skipped or failed, fallback to defaults",
};

export function parseIntentPrediction(parsed: Record<string, any>): IntentPredictionResult {
  return {
    difficulty: (["easy", "medium", "hard", "mygod"].includes(parsed.difficulty as string) ? parsed.difficulty : "medium") as DifficultyLevel,
    modelProfile: (["basic", "balanced", "advanced"].includes(parsed.model_profile as string) ? parsed.model_profile : "balanced") as ModelProfile,
    intent: (["instruction", "question", "creative", "conversation"].includes(parsed.intent as string) ? parsed.intent : "conversation") as IntentPredictionResult["intent"],
    contextRelevance: (["standalone", "follow_up", "continuation"].includes(parsed.context_relevance as string) ? parsed.context_relevance : "standalone") as IntentPredictionResult["contextRelevance"],
    memoryQuery: typeof parsed.memory_query === "string" ? parsed.memory_query.trim() : "",
    topic: typeof parsed.topic === "string" ? parsed.topic : "",
    reasoning: parsed.reasoning ?? "",
  };
}

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

      const raw = await callLLM({
        apiKey: this.#apiKey,
        model: this.#model,
        baseUrl: this.#baseUrl,
        systemKey: PromptKey.PREDICT_INTENT,
        prompt: input.contextMessages
          ? `Recent conversation:\n${input.contextMessages}\n\nCurrent user message: "${text}"`
          : `User message: "${text}"`,
        maxTokens: this.#maxTokens,
      });

      const parsed = parseJsonFromLLMResponse<Record<string, any>>(raw);
      if (!parsed) {
        this.report(BusEvents.Element.Data, { step: "no JSON in response, fallback" });
        return { ...input, mode: "routing", prediction: FALLBACK };
      }

      const prediction = parseIntentPrediction(parsed);
      this.report(BusEvents.Element.Data, { step: "done", difficulty: prediction.difficulty, modelProfile: prediction.modelProfile, intent: prediction.intent, contextRelevance: prediction.contextRelevance, memoryQuery: prediction.memoryQuery, topic: prediction.topic, reasoning: prediction.reasoning });
      return { ...input, mode: "routing", prediction };
    } catch (err: any) {
      this.report(BusEvents.Element.Data, { step: "error, fallback", error: err?.message });
      return { ...input, mode: "routing", prediction: FALLBACK };
    }
  }
}
