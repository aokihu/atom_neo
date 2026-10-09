import { generateText, Output } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { PromptKey, resolvePrompt } from "@atom-neo/shared";
import { z } from "zod";
import { callJev } from "./jev-client";
import type { JevQuestion } from "./jev-client";

export type DecisionModel = { type?: "llm" | "jev"; apiKey: string; model: string; baseUrl?: string; beforeCall?: (signal?: AbortSignal) => Promise<void> };
export type ChoiceQuestions = Record<string, Extract<JevQuestion, { type: "choice" }>>;
export type DecisionUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; cost?: number };
export type DecisionResult = { source: "jev" | "llm"; choices: DecisionChoices; usage?: DecisionUsage };
export type DecisionChoices = Record<string, { choice: string; probabilities: Record<string, number>; confidence?: number }>;
export type SimulateDecision = (state: Record<string, unknown>, questions: ChoiceQuestions, signal?: AbortSignal, model?: DecisionModel) => Promise<Record<string, string>>;
export type DecisionRequest = {
  source: "jev" | "llm"; model: string; state: Record<string, unknown>; questions: ChoiceQuestions;
  maxTokens?: number; maxRetries?: number;
};

export type DecisionParams = {
  state: Record<string, unknown>; questions: ChoiceQuestions;
  model: DecisionModel; fallback: DecisionModel; maxTokens?: number; maxRetries?: number;
  abortSignal?: AbortSignal; fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  simulate?: SimulateDecision;
  onRequest?: (request: DecisionRequest) => void;
  fallbackOnError?: boolean;
  timeoutMs?: number;
  onFailure?: (error: string, source: "jev" | "llm") => void;
};

export async function chooseDecision(params: DecisionParams): Promise<DecisionResult> {
  const native = params.model.type === "jev" && !!params.model.apiKey && !!params.model.baseUrl;
  const attempt = async (model: DecisionModel) => {
    params.abortSignal?.throwIfAborted();
    await model.beforeCall?.(params.abortSignal);
    params.abortSignal?.throwIfAborted();
    if (!params.timeoutMs) return chooseDecisionOnce({ ...params, model });
    const controller = new AbortController();
    const signal = params.abortSignal ? AbortSignal.any([params.abortSignal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(new Error("decision timeout")), params.timeoutMs);
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([chooseDecisionOnce({ ...params, model, abortSignal: signal }),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        })]);
    } finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
  };
  try { return await attempt(params.model); }
  catch (error) {
    params.abortSignal?.throwIfAborted();
    params.onFailure?.(String(error), native ? "jev" : "llm");
    if (!native || !params.fallbackOnError) throw error;
    try { return await attempt({ ...params.fallback, type: "llm" }); }
    catch (fallbackError) {
      params.abortSignal?.throwIfAborted();
      params.onFailure?.(String(fallbackError), "llm");
      throw fallbackError;
    }
  }
}

async function chooseDecisionOnce(params: DecisionParams): Promise<DecisionResult> {
  const { state, questions, abortSignal } = params;
  const useJev = params.model.type === "jev" && !!params.model.apiKey && !!params.model.baseUrl;
  const model = useJev || (params.model.type !== "jev" && params.model.apiKey) ? params.model : params.fallback;
  if (!model.apiKey) throw new Error("no decision model API key");
  params.onRequest?.({ source: useJev ? "jev" : "llm", model: model.model, state, questions,
    ...(!useJev ? { maxTokens: params.maxTokens ?? 512, maxRetries: params.maxRetries } : {}) });
  let choices: DecisionChoices;
  let usage: DecisionUsage | undefined;
  if (useJev) {
    const response = await callJev({ apiKey: model.apiKey, model: model.model, endpoint: model.baseUrl!,
      state, questions, abortSignal, fetchImpl: params.fetchImpl });
    if (response.usage) usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
      ...(response.usage.input_tokens !== undefined && response.usage.output_tokens !== undefined
        ? { totalTokens: response.usage.input_tokens + response.usage.output_tokens } : {}), cost: response.usage.cost };
    choices = Object.fromEntries(Object.entries(response.answers).map(([id, answer]) => [id,
      answer.type === "choice" ? answer : { choice: "", probabilities: {} }]));
  } else {
    let answers: Record<string, string>;
    if (params.simulate) answers = await params.simulate(state, questions, abortSignal, model);
    else {
      const result = await generateText({
        model: createDeepSeek({ apiKey: model.apiKey, baseURL: model.baseUrl })(model.model),
        instructions: resolvePrompt(PromptKey.SIMULATE_JEV), prompt: JSON.stringify({ state, questions }),
        output: Output.object({ schema: z.object({ answers: z.record(z.string(), z.string()) }) }),
        maxOutputTokens: params.maxTokens ?? 512, maxRetries: params.maxRetries, temperature: 0, abortSignal,
      });
      answers = result.output.answers;
      usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens };
    }
    choices = Object.fromEntries(Object.entries(answers).map(([id, choice]) => [id, {
      choice, probabilities: Object.fromEntries(Object.keys(questions[id]?.criteria ?? {}).map(option => [option, option === choice ? 1 : 0])),
    }]));
  }
  for (const [id, question] of Object.entries(questions)) {
    if (!Object.hasOwn(question.criteria, choices[id]?.choice)) throw new Error(`invalid decision choice: ${id}`);
  }
  return { source: useJev ? "jev" : "llm", choices, ...(usage ? { usage } : {}) };
}
