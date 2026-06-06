import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { BusEvents } from "@atom-neo/shared";
import type { IntentPredictionResult, DifficultyLevel, ModelProfile } from "@atom-neo/shared";
import type { PredictionFlowState } from "./types";

const PREDICT_SYSTEM_PROMPT = `You are an intent classifier. Analyze the user's message and classify:

1. difficulty: "easy" | "medium" | "hard" | "mygod"
   - "easy": single-step ask-and-answer, no sub-tasks
   - "medium": moderate complexity, may involve multiple files or small changes
   - "hard": complex task with 3+ sub-steps that should be planned with a todo list
   - "mygod": extremely complex, very large scope, must be done step-by-step with todo

2. model_profile: "basic" | "balanced" | "advanced"
   - "basic": lightweight model is sufficient (simple Q&A, short text)
   - "balanced": moderate reasoning depth needed (code generation, multi-file changes)
   - "advanced": deep reasoning, complex debugging, or architectural analysis required

3. task_intent: "tool_execution" | "creative_generation" | "knowledge_retrieval" | "conversation"
   - "tool_execution": executing commands, querying APIs, manipulating files, multi-step tasks involving planning and coordination of multiple tool calls
   - "creative_generation": writing long articles, generating code, composing text
   - "knowledge_retrieval": searching memory, looking up documentation, recalling facts
   - "conversation": casual chat, Q&A, brief explanations

4. context_relevance: "standalone" | "follow_up" | "continuation"
   - "standalone": new topic, unrelated to conversation history
   - "follow_up": follows up on the previous response, needs full context
   - "continuation": explicitly continuing a previously interrupted task

When recent conversation history is provided in the prompt, use it to determine
context_relevance. A standalone message in a multi-turn conversation may still be
"standalone" if it switches to a completely new topic.

Difficulty vs Model Profile:
The difficulty describes how complex the user's TASK is. Model profile describes
how much REASONING POWER is needed. They are independent:
- "write 20 paragraphs of history" → difficulty=hard (complex scope) but model_profile=balanced (no deep reasoning)
- "debug a concurrent race condition" → difficulty=medium (1 problem) but model_profile=advanced (deep reasoning)
- "what is 2+2" → difficulty=easy, model_profile=basic

When difficulty is "hard" or "mygod", the assistant will be instructed to use a todo list
to plan and execute step by step. This is an execution strategy, not a model requirement.

Reply ONLY with JSON in this exact format:
{"difficulty":"...","model_profile":"...","task_intent":"...","context_relevance":"...","reasoning":"brief explanation"}`;

const FALLBACK: IntentPredictionResult = {
  difficulty: "medium",
  modelProfile: "balanced",
  taskIntent: "conversation",
  contextRelevance: "standalone",
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
      this.report(BusEvents.Element.Data, { step: "empty input, fallback" });
      return { ...input, mode: "routing", prediction: FALLBACK };
    }

    if (!this.#apiKey) {
      this.report(BusEvents.Element.Data, { step: "no apiKey, fallback" });
      return { ...input, mode: "routing", prediction: FALLBACK };
    }

    try {
      const provider = createDeepSeek({ apiKey: this.#apiKey, baseURL: this.#baseUrl });
      const model = provider(this.#model);

      this.report(BusEvents.Element.Data, { step: "classifying", userMsgLen: text.length });

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
        this.report(BusEvents.Element.Data, { step: "no JSON in response, fallback" });
        return { ...input, mode: "routing", prediction: FALLBACK };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const prediction: IntentPredictionResult = {
        difficulty: (["easy", "medium", "hard", "mygod"].includes(parsed.difficulty) ? parsed.difficulty : "medium") as DifficultyLevel,
        modelProfile: (["basic", "balanced", "advanced"].includes(parsed.model_profile) ? parsed.model_profile : "balanced") as ModelProfile,
        taskIntent: (["tool_execution", "creative_generation", "knowledge_retrieval", "conversation"].includes(parsed.task_intent) ? parsed.task_intent : "conversation") as IntentPredictionResult["taskIntent"],
        contextRelevance: (["standalone", "follow_up", "continuation"].includes(parsed.context_relevance) ? parsed.context_relevance : "standalone") as IntentPredictionResult["contextRelevance"],
        reasoning: parsed.reasoning ?? "",
      };
      this.report(BusEvents.Element.Data, { step: "done", difficulty: prediction.difficulty, modelProfile: prediction.modelProfile, taskIntent: prediction.taskIntent, contextRelevance: prediction.contextRelevance, reasoning: prediction.reasoning });
      return { ...input, mode: "routing", prediction };
    } catch (err: any) {
      this.report(BusEvents.Element.Data, { step: "error, fallback", error: err?.message });
      return { ...input, mode: "routing", prediction: FALLBACK };
    }
  }
}
