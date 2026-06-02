import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { streamText, tool, jsonSchema } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ToolDefinition } from "@atom-neo/shared";
import { BusEvents, IntentRequestType, IntentRequestSource } from "@atom-neo/shared";
import type { IntentRequest } from "@atom-neo/shared";
import type { TokenUsage } from "../../../session/context";
import { DEFAULT_MAX_TOKENS } from "../../../constants";
import { IntentInputSchema } from "../../../tools/builtin/intent";
import type { IntentToolInput } from "../../../tools/builtin/intent";
import type { ConversationFlowState } from "./types";

export class StreamLLMElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #apiKey: string;
  #model: string;
  #baseUrl?: string;
  #tools: ToolDefinition[];
  #maxTokens: number;
  #maxSteps: number;
  #providerOptions: Record<string, any>;
  #taskIntent: string;
  #toolTier: string;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    apiKey: string;
    model: string;
    baseUrl?: string;
    tools: ToolDefinition[];
    maxTokens?: number;
    maxSteps?: number;
    providerOptions?: Record<string, any>;
    taskIntent?: string;
    toolTier?: string;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#apiKey = params.apiKey;
    this.#model = params.model;
    this.#baseUrl = params.baseUrl;
    this.#tools = params.tools;
    this.#maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.#maxSteps = params.maxSteps ?? 20;
    this.#providerOptions = params.providerOptions ?? {};
    this.#taskIntent = params.taskIntent ?? "conversation";
    this.#toolTier = params.toolTier ?? "basic";
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "formatted") return input;
    if (!this.#apiKey) {
      this.report(BusEvents.Element.Data, { step: "no apiKey, fallback" });
      return { ...input, mode: "executing", responseText: "(no API key configured)" };
    }

    const userMessages = input.userMessages ?? [];
    const systemText = input.systemText ?? "";

    const tools = this.#filterToolsByIntent();
    this.report(BusEvents.Element.Data, { step: "starting LLM call", model: this.#model, msgCount: userMessages.length, toolCount: tools.length, taskIntent: this.#taskIntent });

    const provider = createDeepSeek({ apiKey: this.#apiKey, baseURL: this.#baseUrl });
    const model = provider(this.#model);

    const intentSignal: { value: IntentToolInput | null } = { value: null };

    const aiTools: Record<string, any> = {};
    for (const t of tools) {
      aiTools[t.name] = tool({
        description: t.description,
        parameters: jsonSchema(t.inputSchema as any),
        execute: t.name === "intent"
          ? async (args: any) => {
              const parsed = IntentInputSchema.safeParse(args);
              if (parsed.success) intentSignal.value = parsed.data;
              return "Intent received";
            }
          : async (args: any) => {
              const result = await t.execute(args);
              if (!result.ok) return `Error: ${result.error}`;
              return result.output || JSON.stringify(result.data);
            },
      });
    }

    try {
      const streamResult = streamText({
        model,
        system: systemText || undefined,
        messages: userMessages as any,
        tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
        maxSteps: this.#maxSteps,
        maxTokens: this.#maxTokens,
        allowSystemInMessages: true,
        providerOptions: this.#providerOptions,
      } as any);

      let fullText = "";
      let intentData: IntentToolInput | null = null;
      let finishReason = "";

      for await (const chunk of streamResult.fullStream) {
        if (chunk.type === "step-finish") {
          finishReason = (chunk as any).finishReason ?? "";
          continue;
        }
        if (chunk.type === "tool-call") {
          const c = chunk as any;
          if (c.toolName === "intent") {
            intentData = intentSignal.value ?? c.input;
            break;
          }
          this.report(BusEvents.Element.Data, { step: "tool-call-start", toolName: c.toolName, args: String(c.input ?? c.args).slice(0, 200) });
          continue;
        }
        if (chunk.type === "tool-result") {
          const c = chunk as any;
          if (c.toolName === "intent") continue;
          this.report(BusEvents.Element.Data, { step: "tool-call-finish", toolName: c.toolName, result: String(c.output ?? c.result).slice(0, 300) });
          continue;
        }
        if (chunk.type !== "text-delta") continue;

        fullText += chunk.textDelta;
        this.report(BusEvents.Transport.Delta, { textDelta: chunk.textDelta });
      }

      const intents: IntentRequest[] = intentData ? [toIntentRequest(intentData)] : [];

      const response = await streamResult.response;
      const reasoningContent = (response.messages as any[])?.find((m: any) =>
        m.role === "assistant" && m.reasoningContent
      )?.reasoningContent ?? "";
      const usage = await streamResult.usage;
      const tokenUsage: TokenUsage = { total: usage?.totalTokens ?? 0 };
      this.report(BusEvents.Element.Data, { step: "done", outputLen: fullText.length, tokens: tokenUsage.total, hasIntents: intents.length > 0, finishReason });

      const chainAction = intents.some(i => i.request === IntentRequestType.REQUEST_MORE_TOOLS) ? "more_tools"
        : intents.some(i => i.request === IntentRequestType.FOLLOW_UP) ? "follow_up"
        : finishReason === "length" ? "follow_up"
        : undefined;

      return {
        ...input,
        mode: "executing",
        responseText: fullText,
        reasoningContent: String(reasoningContent),
        tokenUsage,
        intents,
        chainAction,
      };
    } catch (err: any) {
      this.report(BusEvents.Element.Data, { step: "error", level: "warn", error: err?.message ?? String(err) });
      return {
        ...input,
        mode: "executing",
        responseText: `Error: ${err?.message ?? String(err)}`,
      };
    }
  }

  #filterToolsByIntent(): ToolDefinition[] {
    const nonIntent = this.#tools.filter(t => t.name !== "intent");
    const intent = this.#tools.find(t => t.name === "intent");
    if (this.#toolTier === "full") return intent ? [...nonIntent, intent] : nonIntent;
    let filtered: ToolDefinition[];
    switch (this.#taskIntent) {
      case "creative_generation":
        filtered = [];
        break;
      case "conversation": {
        const excluded = new Set(["search_memory", "save_memory", "link_memory"]);
        filtered = nonIntent.filter(t => !excluded.has(t.name));
        break;
      }
      case "knowledge_retrieval": {
        const allowed = new Set(["read", "grep", "ls", "tree", "search_memory"]);
        filtered = nonIntent.filter(t => allowed.has(t.name));
        break;
      }
      case "tool_execution":
      default:
        filtered = nonIntent;
        break;
    }
    return intent ? [...filtered, intent] : filtered;
  }
}

function toIntentRequest(input: IntentToolInput): IntentRequest {
  switch (input.action) {
    case "request_more_tools":
      return { source: IntentRequestSource.CONVERSATION, request: IntentRequestType.REQUEST_MORE_TOOLS, intent: "more tools", params: input };
    case "follow_up":
      return { source: IntentRequestSource.CONVERSATION, request: IntentRequestType.FOLLOW_UP, intent: "follow up", params: input };
    case "keep_memory":
      return { source: IntentRequestSource.CONVERSATION, request: IntentRequestType.KEEP_MEMORY, intent: "keep", params: { id: input.mem_id } };
    default:
      return { source: IntentRequestSource.CONVERSATION, request: IntentRequestType.FOLLOW_UP, intent: "follow up", params: input };
  }
}
