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
  #session: any;

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
    session?: any;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#apiKey = params.apiKey;
    this.#model = params.model;
    this.#baseUrl = params.baseUrl;
    this.#tools = params.tools;
    this.#maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.#maxSteps = params.maxSteps ?? 50;
    this.#providerOptions = params.providerOptions ?? {};
    this.#taskIntent = params.taskIntent ?? "conversation";
    this.#session = params.session;
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
    const stepCounter = { count: 0 };

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
          : async (args: any, opts?: any) => {
              const sc = ++stepCounter.count;
              const start = Date.now();
              try {
                this.report(BusEvents.Element.Data, { step: "tool-execute-start", toolName: t.name, stepCount: sc, args: JSON.stringify(args).slice(0, 200) });
                const result = await t.execute(args, { abortSignal: opts?.abortSignal });
                const duration = Date.now() - start;
                this.report(BusEvents.Element.Data, { step: "tool-execute-done", toolName: t.name, stepCount: sc, duration, ok: result.ok });
                if (t.name === "todowrite" && result.ok && this.#session?.setTodoState) {
                  this.#session.setTodoState((args as any).todos ?? []);
                }
                if (!result.ok) return `Error: ${result.error}`;
                return result.output || JSON.stringify(result.data);
              } catch (err: any) {
                const duration = Date.now() - start;
                this.report(BusEvents.Element.Data, { step: "tool-execute-error", toolName: t.name, stepCount: sc, duration, error: err?.message ?? String(err) });
                return `Tool execution error: ${err?.message ?? String(err)}`;
              }
            },
      });
    }

    try {
      const STREAM_TIMEOUT_MS = 300_000;
      const abortController = new AbortController();

      const streamResult = streamText({
        model,
        system: systemText || undefined,
        messages: userMessages as any,
        tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
        maxSteps: this.#maxSteps,
        maxTokens: this.#maxTokens,
        allowSystemInMessages: true,
        providerOptions: this.#providerOptions,
        abortSignal: abortController.signal,
      } as any);

      let fullText = "";
      let intentData: IntentToolInput | null = null;
      let finishReason = "";

      let timedOut = false;
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        this.report(BusEvents.Element.Data, { step: "stream-timeout", level: "warn", stepCount: stepCounter.count });
        abortController.abort();
      }, STREAM_TIMEOUT_MS);

      const iterator = streamResult.fullStream[Symbol.asyncIterator]();

      try {
        while (true) {
          const { value: chunk, done } = await iterator.next();
          if (done) break;

          if (chunk.type === "step-start") continue;
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
            this.report(BusEvents.Element.Data, { step: "tool-call-start", toolName: c.toolName, stepCount: stepCounter.count, args: JSON.stringify(c.input ?? c.args).slice(0, 200) });
            continue;
          }
          if (chunk.type === "tool-result") {
            const c = chunk as any;
            if (c.toolName === "intent") continue;
            this.report(BusEvents.Element.Data, { step: "tool-call-finish", toolName: c.toolName, stepCount: stepCounter.count, result: JSON.stringify(c.output ?? c.result).slice(0, 300) });
            continue;
          }
          if (chunk.type === "text-delta") {
            fullText += chunk.textDelta;
            this.report(BusEvents.Transport.Delta, { textDelta: chunk.textDelta });
            continue;
          }
          if (chunk.type === "finish") {
            finishReason = (chunk as any).finishReason ?? finishReason;
            continue;
          }
          this.report(BusEvents.Element.Data, { step: "unhandled-chunk", type: (chunk as any).type, raw: JSON.stringify(chunk).slice(0, 200) });
        }
      } finally {
        clearTimeout(timeoutTimer);
      }

      this.report(BusEvents.Element.Data, { step: "stream-loop-ended", timedOut, finishReason: finishReason || "natural", stepCount: stepCounter.count, fullTextLen: fullText.length });

      if (!finishReason || finishReason === "tool-calls") {
        if (fullText.length > 0 && stepCounter.count === 0) {
          finishReason = "stop";
        } else {
          this.report(BusEvents.Element.Data, { step: "stream-aborted", level: "warn", timedOut, finishReason: finishReason || "none" });
          finishReason = "error";
          setTimeout(() => {
            if (!abortController.signal.aborted) abortController.abort();
          }, 60_000);
        }
      }

      const intents: IntentRequest[] = intentData ? [toIntentRequest(intentData)] : [];

      let response: any;
      let usage: any;

      try {
        response = await streamResult.response;
      } catch (err: any) {
        this.report(BusEvents.Element.Data, { step: "response-error", level: "warn", error: err?.message ?? String(err) });
        response = { messages: [] };
        if (!finishReason) finishReason = "error";
      }

      try {
        usage = await streamResult.usage;
      } catch (err: any) {
        this.report(BusEvents.Element.Data, { step: "usage-error", level: "warn", error: err?.message ?? String(err) });
        usage = { totalTokens: 0 };
        if (!finishReason) finishReason = "error";
      }

      const reasoningContent = (response.messages as any[])?.find((m: any) =>
        m.role === "assistant" && m.reasoningContent
      )?.reasoningContent ?? "";
      const tokenUsage: TokenUsage = { total: usage?.totalTokens ?? 0 };
      this.report(BusEvents.Element.Data, { step: "done", outputLen: fullText.length, tokens: tokenUsage.total, hasIntents: intents.length > 0, finishReason, stepCount: stepCounter.count, maxSteps: this.#maxSteps });

      if (stepCounter.count >= this.#maxSteps) {
        this.report(BusEvents.Element.Data, { step: "maxSteps-exhausted", level: "warn", stepCount: stepCounter.count, maxSteps: this.#maxSteps });
      }

      const chainAction = intents.some(i => i.request === IntentRequestType.FOLLOW_UP) ? "follow_up"
        : finishReason === "length" ? "follow_up"
        : finishReason === "error" ? "follow_up"
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
        const allowed = new Set(["read", "grep", "ls", "tree", "glob", "webfetch", "search_memory"]);
        filtered = nonIntent.filter(t => allowed.has(t.name));
        break;
      }
      case "tool_execution":
      default:
        filtered = nonIntent.filter(t => t.name !== "todowrite" || this.#taskIntent === "tool_execution");
        break;
    }
    return intent ? [...filtered, intent] : filtered;
  }
}

function toIntentRequest(input: IntentToolInput): IntentRequest {
  switch (input.action) {
    case "follow_up":
      return { source: IntentRequestSource.CONVERSATION, request: IntentRequestType.FOLLOW_UP, intent: "follow up", params: input };
    case "keep_memory":
      return { source: IntentRequestSource.CONVERSATION, request: IntentRequestType.KEEP_MEMORY, intent: "keep", params: { id: input.mem_id } };
    default:
      return { source: IntentRequestSource.CONVERSATION, request: IntentRequestType.FOLLOW_UP, intent: "follow up", params: input };
  }
}
