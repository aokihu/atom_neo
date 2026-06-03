import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { generateText } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { BusEvents } from "@atom-neo/shared";
import type { PostConversationFlowState, AnalysisResult } from "./types";

const ANALYZE_SYSTEM_PROMPT = `你是一个会话质量评估器。判断AI是否**完成了**用户的请求。

评分标准:
- "satisfactory": AI直接回答了问题，提供了实质信息
- "blocked": AI只表达了意图(如"让我搜索"、"我来查询"、"我需要查找")但未提供实际答案；或回复内容与用户提问完全无关；或明确表示无法完成

关键判断规则:
- 回复较短(≤50字)且包含"搜索"、"查询"、"尝试"、"让我"、"看看"等表态词 → blocked
- 回复内容与用户提问无关 → blocked
- 其他情况 → satisfactory

仅回复JSON: {"status":"satisfactory|blocked","reason":"简短说明"}`;

const FALLBACK: AnalysisResult = { status: "satisfactory", reason: "skip" };

const NON_RETRY_TASK_INTENTS = new Set(["creative_generation", "conversation"]);

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

    if (input.predictedToolTier === "full") {
      this.report(BusEvents.Element.Data, { step: "skip, full tools" });
      return { ...input, mode: "acting", analysis: FALLBACK };
    }

    if (NON_RETRY_TASK_INTENTS.has(input.predictedTaskIntent)) {
      this.report(BusEvents.Element.Data, { step: "skip, non-retry task intent", taskIntent: input.predictedTaskIntent });
      return { ...input, mode: "acting", analysis: FALLBACK };
    }

    if (input.stepCount === 0 && input.assistantResponse.length > 0) {
      this.report(BusEvents.Element.Data, { step: "skip, no tools used with output" });
      return { ...input, mode: "acting", analysis: FALLBACK };
    }

    try {
      const provider = createDeepSeek({ apiKey: this.#apiKey, baseURL: this.#baseUrl });
      const model = provider(this.#model);

      const TASK_INTENT_DESC: Record<string, string> = {
        tool_execution: "应执行文件操作、命令或其他工具任务",
        knowledge_retrieval: "应搜索信息、查询知识并提供答案",
        creative_generation: "应生成文章、代码等创作内容",
        conversation: "应进行对话交流、解答疑问",
      };

      const prompt = [
        `用户请求: ${input.userMessage.slice(0, 500)}`,
        `AI回复: ${input.assistantResponse.slice(0, 3000)}`,
        `预期任务: ${TASK_INTENT_DESC[input.predictedTaskIntent] ?? "对话交流"}`,
        `可用工具级别: ${input.predictedToolTier === "full" ? "完整工具集" : "仅文件读写和搜索"}`,
      ].join("\n");

      this.report(BusEvents.Element.Data, { step: "analyzing", userMsgLen: input.userMessage.length, assistantMsgLen: input.assistantResponse.length });

      const result = await generateText({
        model,
        system: ANALYZE_SYSTEM_PROMPT,
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
      this.report(BusEvents.Element.Data, { step: "error, fallback", error: err?.message });
      return { ...input, mode: "acting", analysis: FALLBACK };
    }
  }
}
