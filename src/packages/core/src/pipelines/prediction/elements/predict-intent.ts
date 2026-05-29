import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { generateText, jsonSchema } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { IntentPredictionResult } from "@atom-neo/shared";
import type { PredictionFlowState } from "./types";

const PREDICT_SYSTEM_PROMPT = `You are an intent classifier. Analyze the user's message and classify it into two dimensions:

1. tool_tier: "basic" or "full"
   - "full": the user wants to run shell commands, access network resources (curl/wget), 
     perform batch file operations (copy/move directories), or recall past conversation memory.
   - "basic": the user only needs file read/write, search, directory listing, or simple edits.

2. difficulty: "basic", "balanced", or "advanced"
   - "basic": single-step operations like reading a file, searching text, listing files.
   - "balanced": multi-step tasks, code generation, moderate modifications, running simple commands.
   - "advanced": system design, architecture refactoring, complex debugging, deployment tasks.

When recent conversation history is provided in the prompt, use it to understand the context 
of multi-turn conversations. A seemingly simple current message may actually be a follow-up 
or progress check on a more complex ongoing task that was started earlier in the conversation.

Reply ONLY with JSON in this exact format:
{"tool_tier":"basic or full","difficulty":"basic or balanced or advanced","reasoning":"brief explanation"}`;

const FALLBACK: IntentPredictionResult = {
  toolTier: "basic",
  difficulty: "balanced",
  reasoning: "prediction skipped or failed, fallback to defaults",
};

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
      return { ...input, mode: "routing", prediction: FALLBACK };
    }

    if (!this.#apiKey) {
      return { ...input, mode: "routing", prediction: FALLBACK };
    }

    try {
      const provider = createDeepSeek({ apiKey: this.#apiKey, baseURL: this.#baseUrl });
      const model = provider(this.#model);

      const result = await generateText({
        model,
        system: PREDICT_SYSTEM_PROMPT,
        prompt: input.contextMessages
          ? `Recent conversation:\n${input.contextMessages}\n\nCurrent user message: "${text}"`
          : `User message: "${text}"`,
        maxTokens: this.#maxTokens,
        temperature: 0,
      });

      const raw = result.text.trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { ...input, mode: "routing", prediction: FALLBACK };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        ...input,
        mode: "routing",
        prediction: {
          toolTier: parsed.tool_tier === "full" ? "full" : "basic",
          difficulty: (["basic", "balanced", "advanced"].includes(parsed.difficulty) ? parsed.difficulty : "balanced") as IntentPredictionResult["difficulty"],
          reasoning: parsed.reasoning ?? "",
        },
      };
    } catch {
      return { ...input, mode: "routing", prediction: FALLBACK };
    }
  }
}
