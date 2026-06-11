import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { BusEvents, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type { PostConversationFlowState, AnalysisResult } from "./types";

const FALLBACK: AnalysisResult = { status: "satisfactory", reason: "skip" };

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
      return { ...input, mode: "acting", analysis: FALLBACK };
    }

    if (!this.#apiKey) {
      this.report(BusEvents.Element.Data, { step: "skip, no apiKey" });
      return { ...input, mode: "acting", analysis: FALLBACK };
    }

    try {
      const provider = createDeepSeek({ apiKey: this.#apiKey, baseURL: this.#baseUrl });
      const model = provider(this.#model);

      const TASK_INTENT_DESC: Record<string, string> = {
        instruction: "应执行文件操作、命令或其他工具任务",
        question: "应搜索信息、查询知识并提供答案",
        creative: "应生成文章、代码等创作内容",
        conversation: "应进行对话交流、解答疑问",
      };

      const prompt = [
        `用户请求: ${input.userMessage.slice(0, 500)}`,
        `AI回复: ${input.assistantResponse.slice(0, 3000)}`,
        `预期任务: ${TASK_INTENT_DESC[input.predictedTaskIntent] ?? "对话交流"}`,
      ].join("\n");

      this.report(BusEvents.Element.Data, { step: "analyzing", userMsgLen: input.userMessage.length, assistantMsgLen: input.assistantResponse.length });

      const result = await generateText({
        model,
        system: resolvePrompt(PromptKey.ANALYZE_RESULT),
        prompt,
        maxTokens: this.#maxTokens,
        temperature: 0,
      });

      const raw = result.text.trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.report(BusEvents.Element.Data, { step: "no JSON, fallback to satisfactory" });
        return { ...input, mode: "acting", analysis: FALLBACK };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const status = ["satisfactory", "blocked"].includes(parsed.status) ? parsed.status : "satisfactory";
      const analysis: AnalysisResult = { status, reason: parsed.reason ?? "" };

      this.report(BusEvents.Element.Data, { step: "analyzed", status, reason: analysis.reason });
      return { ...input, mode: "acting", analysis };
    } catch (err: any) {
      this.report(BusEvents.Element.Data, {
        step: "error, fallback",
        error: err?.message?.slice(0, 300),
        errorName: err?.name,
        statusCode: err?.statusCode,
        responseBody: (err?.responseBody ?? "").slice(0, 200),
      });
      return { ...input, mode: "acting", analysis: FALLBACK };
    }
  }
}
