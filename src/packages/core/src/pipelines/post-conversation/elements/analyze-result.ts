import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents, PromptKey, substringWellFormed } from "@atom-neo/shared";
import type { PostConversationFlowState, AnalysisResult } from "./types";
import { FALLBACK_ANALYSIS } from "./types";
import { callLLM, parseJsonFromLLMResponse } from "../../shared";

const NON_RETRY_TASK_INTENTS = new Set(["creative", "conversation"]);

export class AnalyzeResultElement extends BaseElement<PostConversationFlowState, PostConversationFlowState> {
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
    this.#maxTokens = params.maxTokens ?? 256;
  }

  async doProcess(input: PostConversationFlowState): Promise<PostConversationFlowState> {
    if (input.mode !== "analyzing") return input;

    if (!input.userMessage || !input.assistantResponse) {
      this.report(BusEvents.Element.Data, { step: "skip, empty input" });
      return { ...input, mode: "acting", analysis: FALLBACK_ANALYSIS };
    }

    if (!this.#apiKey) {
      this.report(BusEvents.Element.Data, { step: "skip, no apiKey" });
      return { ...input, mode: "acting", analysis: FALLBACK_ANALYSIS };
    }

    try {
      const TASK_INTENT_DESC: Record<string, string> = {
        instruction: "应执行文件操作、命令或其他工具任务",
        question: "应搜索信息、查询知识并提供答案",
        creative: "应生成文章、代码等创作内容",
        conversation: "应进行对话交流、解答疑问",
      };

      const prompt = [
        `用户请求: ${substringWellFormed(input.userMessage, 0, 500)}`,
        `AI回复元数据: parts=${input.assistantParts}, chars=${input.assistantLength}, activeTodos=${input.activeTodoCount}, finishReason=${input.finishReason || "unknown"}, completeDetected=${input.completeDetected}`,
        `工具事实: primaryEvidence=${input.toolOutcomeSummary.evidence}, referenceEvidence=${input.toolOutcomeSummary.referenceEvidence}, stateChanged=${input.toolOutcomeSummary.stateChanged}, empty=${input.toolOutcomeSummary.empty}, error=${input.toolOutcomeSummary.error}, blocked=${input.toolOutcomeSummary.blocked}, deferred=${input.toolOutcomeSummary.deferred}, cancelled=${input.toolOutcomeSummary.cancelled}`,
        `AI回复声明（未验证参考，不能仅凭其自述判定完成）: ${substringWellFormed(input.assistantResponse, 0, 3000)}`,
        `预期任务: ${TASK_INTENT_DESC[input.predictedTaskIntent] ?? "对话交流"}`,
        "判定顺序: 用户请求 > primary evidence/state change > MCP reference evidence > 完成元数据 > AI回复声明。MCP reference 只能辅助判断，不能单独支撑高置信度完成；工具型任务没有 primary evidence/stateChanged 且只有 empty/error/blocked/deferred 时，不得仅凭 AI 自述判为 satisfactory。",
      ].join("\n");

      this.report(BusEvents.Element.Data, { step: "analyzing", userMsgLen: input.userMessage.length, assistantMsgLen: input.assistantResponse.length });

      const raw = await callLLM({
        apiKey: this.#apiKey,
        model: this.#model,
        baseUrl: this.#baseUrl,
        systemKey: PromptKey.ANALYZE_RESULT,
        prompt,
        maxTokens: this.#maxTokens,
        abortSignal: input.abortSignal,
      });

      const parsed = parseJsonFromLLMResponse<{ status: string; reason?: string; fingerprint?: string }>(raw);
      if (!parsed) {
        this.report(BusEvents.Element.Data, { step: "no JSON, fallback to satisfactory" });
        return { ...input, mode: "acting", analysis: FALLBACK_ANALYSIS };
      }

      const status = ["satisfactory", "blocked", "needs_user_input"].includes(parsed.status) ? parsed.status as AnalysisResult["status"] : "satisfactory";
      const analysis: AnalysisResult = { status, reason: parsed.reason ?? "", fingerprint: parsed.fingerprint };

      this.report(BusEvents.Element.Data, { step: "analyzed", status, reason: analysis.reason });
      return { ...input, mode: "acting", analysis };
    } catch (err: any) {
      this.report(BusEvents.Element.Data, {
        step: "error, fallback",
        error: err?.message ? substringWellFormed(err.message, 0, 300) : undefined,
        errorName: err?.name,
        statusCode: err?.statusCode,
        responseBody: substringWellFormed(err?.responseBody ?? "", 0, 200),
      });
      return { ...input, mode: "acting", analysis: FALLBACK_ANALYSIS };
    }
  }
}
