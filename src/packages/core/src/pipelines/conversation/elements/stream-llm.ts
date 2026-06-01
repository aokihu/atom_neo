import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { streamText, tool, jsonSchema } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ToolDefinition } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { TokenUsage } from "../../../session/context";
import { DEFAULT_MAX_TOKENS } from "../../../constants";
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
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#apiKey = params.apiKey;
    this.#model = params.model;
    this.#baseUrl = params.baseUrl;
    this.#tools = params.tools;
    this.#maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.#maxSteps = params.maxSteps ?? 10;
    this.#providerOptions = params.providerOptions ?? {};
    this.#taskIntent = params.taskIntent ?? "conversation";
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

    const aiTools: Record<string, any> = {};
    for (const t of tools) {
      aiTools[t.name] = tool({
        description: t.description,
        parameters: jsonSchema(t.inputSchema as any),
        execute: async (args: any) => {
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

      const MARKER = "<<<REQUEST>>>";
      const WINDOW = MARKER.length - 1;
      const CHUNK_BATCH = 3;

      let fullText = "";
      let buffer = "";
      let pastMarker = false;
      let intentRequestText = "";
      let deltaBuffer = "";
      let deltaCount = 0;
      let finishReason = "";

      for await (const chunk of streamResult.fullStream) {
        if (chunk.type === "step-finish") {
          finishReason = (chunk as any).finishReason ?? "";
          continue;
        }
        if (chunk.type !== "text-delta") continue;

        if (pastMarker) {
          intentRequestText += chunk.textDelta;
          continue;
        }

        buffer += chunk.textDelta;
        const idx = buffer.indexOf(MARKER);

        if (idx >= 0) {
          if (idx > 0) {
            fullText += buffer.slice(0, idx);
            deltaBuffer += buffer.slice(0, idx);
            deltaCount++;
          }
          intentRequestText = buffer.slice(idx + MARKER.length);
          pastMarker = true;
          buffer = "";
        } else if (buffer.length > WINDOW) {
          const emitLen = buffer.length - WINDOW;
          const emit = buffer.slice(0, emitLen);
          fullText += emit;
          deltaBuffer += emit;
          deltaCount++;
          buffer = buffer.slice(emitLen);
        }

        if (deltaCount >= CHUNK_BATCH && deltaBuffer) {
          this.report(BusEvents.Transport.Delta, { textDelta: deltaBuffer });
          deltaBuffer = "";
          deltaCount = 0;
        }
      }

      if (buffer) {
        fullText += buffer;
        deltaBuffer += buffer;
      }
      if (deltaBuffer) {
        this.report(BusEvents.Transport.Delta, { textDelta: deltaBuffer });
      }
      const response = await streamResult.response;
      const reasoningContent = (response.messages as any[])?.find((m: any) =>
        m.role === "assistant" && m.reasoningContent
      )?.reasoningContent ?? "";
      const usage = await streamResult.usage;
      const tokenUsage: TokenUsage = {
        total: usage?.totalTokens ?? 0,
      };
      this.report(BusEvents.Element.Data, { step: "done", outputLen: fullText.length, tokens: tokenUsage.total, hasIntents: !!intentRequestText, finishReason });
      return {
        ...input,
        mode: "executing",
        responseText: fullText,
        reasoningContent: String(reasoningContent),
        tokenUsage,
        intentRequestText,
        chainAction: (finishReason === "length" || finishReason === "tool-calls") ? "follow_up" : undefined,
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
    switch (this.#taskIntent) {
      case "creative_generation":
        return [];
      case "conversation": {
        const excluded = new Set(["search_memory", "save_memory", "link_memory"]);
        return this.#tools.filter(t => !excluded.has(t.name));
      }
      case "knowledge_retrieval": {
        const allowed = new Set(["read", "grep", "ls", "tree", "search_memory"]);
        return this.#tools.filter(t => allowed.has(t.name));
      }
      case "tool_execution":
      default:
        return this.#tools;
    }
  }
}
