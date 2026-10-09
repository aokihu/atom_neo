import { BaseElement, BusEvents, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { chooseDecision } from "../../../decision/choose";
import type { ChoiceQuestions, DecisionModel, SimulateDecision } from "../../../decision/choose";
import type { EvaluatorFlowState, EvaluatorResult } from "./types";
import { FALLBACK_EVALUATOR } from "./types";

export class EvaluatorAnalyzeElement extends BaseElement<EvaluatorFlowState, EvaluatorFlowState> {
  #model: DecisionModel;
  #fallback: DecisionModel;
  #simulate?: SimulateDecision;
  #fetch?: (url: string, init: RequestInit) => Promise<Response>;
  #timeout: number;

  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap>;
    apiKey: string; model: string; baseUrl?: string; maxTokens?: number;
    decisionModel?: DecisionModel; fallbackModel?: DecisionModel; simulate?: SimulateDecision;
    fetchImpl?: (url: string, init: RequestInit) => Promise<Response>; timeoutMs?: number }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#model = params.decisionModel ?? { apiKey: params.apiKey, model: params.model, baseUrl: params.baseUrl };
    this.#fallback = params.fallbackModel ?? { apiKey: params.apiKey, model: params.model, baseUrl: params.baseUrl };
    this.#simulate = params.simulate;
    this.#fetch = params.fetchImpl;
    this.#timeout = params.timeoutMs ?? 10_000;
  }

  async doProcess(input: EvaluatorFlowState): Promise<EvaluatorFlowState> {
    if (input.mode !== "analyzing") return input;
    input.abortSignal?.throwIfAborted();
    if (!input.evidence || !input.budgetCheck) return { ...input, mode: "intervening", evaluation: FALLBACK_EVALUATOR };
    const questions: ChoiceQuestions = { health: { type: "choice", instructions: resolvePrompt(PromptKey.EVALUATOR_ANALYZE),
      criteria: {
        healthy: "The provided window excerpts and real executions show concrete progress toward the ORIGINAL goal. This permits more execution, NOT overall acceptance. Distinct substantive sections with corresponding handoffs are progress even if a final validation item remains. TODO changes, length or claims alone are insufficient.",
        looping: "Repeated equivalent output or failed approaches without meaningful progress.",
        stuck: "Persistent failure or dead end prevents further progress.",
        degrading: "Quality, consistency or focus deteriorated within the window.",
        unknown: "The available evidence cannot establish window progress or a failure pattern. Cropping alone does NOT require unknown when the provided excerpts show concrete progress. Do not require proof of full completion or of every word-count constraint to judge window health.",
      } } };
    let fallbackReason: string | undefined;
    try {
      const result = await chooseDecision({ state: input.evidence, questions, model: this.#model, fallback: this.#fallback,
        fallbackOnError: true, timeoutMs: this.#timeout, maxTokens: 512, maxRetries: 0,
        abortSignal: input.abortSignal, simulate: this.#simulate, fetchImpl: this.#fetch,
        onRequest: request => this.report(BusEvents.Element.Data, { step: "decision-request", purpose: "budget-health",
          taskId: input.task.id, budgetCheck: input.budgetCheck, ...request }),
        onFailure: (error, source) => { fallbackReason = error; this.report(BusEvents.Element.Data,
          { step: "decision-failed", taskId: input.task.id, budgetCheck: input.budgetCheck, source, error }); },
      });
      input.abortSignal?.throwIfAborted();
      const health = result.choices.health!.choice as EvaluatorResult["health"];
      this.report(BusEvents.Element.Data, { step: "classified", taskId: input.task.id, budgetCheck: input.budgetCheck,
        source: result.source, choices: result.choices, usage: result.usage ?? null, fallbackReason, health });
      const reasons = {
        healthy: "窗口内存在接近原始目标的具体进展",
        looping: "窗口内重复输出或重复失败方法，未确认有效进展",
        stuck: "窗口内持续失败或死胡同，无法确认可以推进",
        degrading: "窗口内内容质量、一致性或目标焦点退化",
        unknown: "窗口证据不足，进度尚未确认",
      };
      return { ...input, mode: "intervening", evaluation: { health, suggestion: "", upgradeModel: false,
        reason: `${reasons[health]}（${result.source}）` } };
    } catch (error) {
      input.abortSignal?.throwIfAborted();
      return { ...input, mode: "intervening", evaluation: { ...FALLBACK_EVALUATOR, reason: `健康检查失败：${String(error)}` } };
    }
  }
}
