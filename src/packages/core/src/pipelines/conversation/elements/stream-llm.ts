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
  #aiTools: Record<string, any>;
  #maxTokens: number;
  #maxSteps: number;
  #providerOptions: Record<string, any>;
  #taskIntent: string;
  #stepCounter = { count: 0 };
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
    this.#maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.#maxSteps = params.maxSteps ?? 50;
    this.#providerOptions = params.providerOptions ?? {};
    this.#taskIntent = params.taskIntent ?? "conversation";
    this.#session = params.session;
    this.#aiTools = buildAllAiTools(params.tools, (event, payload) => this.report(event, payload), this.#stepCounter, this.#session);
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "formatted") return input;
    if (!this.#apiKey) {
      this.report(BusEvents.Element.Data, { step: "no apiKey, fallback" });
      return { ...input, mode: "executing", responseText: "(no API key configured)" };
    }

    const userMessages = input.userMessages ?? [];
    const systemText = input.systemText ?? "";
    const activeNames = getActiveToolNames(this.#taskIntent);
    const tools = Object.keys(this.#aiTools);
    this.report(BusEvents.Element.Data, { step: "starting LLM call", model: this.#model, msgCount: userMessages.length, toolCount: tools.length, activeCount: activeNames.length, taskIntent: this.#taskIntent });

    const provider = createDeepSeek({ apiKey: this.#apiKey, baseURL: this.#baseUrl });
    const model = provider(this.#model);

    const intentSignal: { value: IntentToolInput | null } = { value: null };
    this.#stepCounter.count = 0;

    // Wire intentSignal into the pre-built intent tool
    const intentAITool = this.#aiTools["intent"];
    if (intentAITool) {
      const origExecute = intentAITool.execute;
      intentAITool.execute = async (args: any) => {
        const parsed = IntentInputSchema.safeParse(args);
        if (parsed.success) intentSignal.value = parsed.data;
        return origExecute(args);
      };
    }

      let fullText = "";
      let intentData: IntentToolInput | null = null;
      let finishReason = "";
      let tokenOverflow = false;

      try {
        const difficulty = this.#session?.pendingPrediction?.difficulty ?? "medium";
        const STREAM_TIMEOUT_MS = resolveTimeout(difficulty);
        const abortController = new AbortController();

        const streamResult = streamText({
        model,
        system: systemText || undefined,
        messages: userMessages as any,
        tools: tools.length > 0 ? this.#aiTools : undefined,
        maxSteps: this.#maxSteps,
        maxTokens: this.#maxTokens,
        allowSystemInMessages: true,
        providerOptions: this.#providerOptions,
        abortSignal: abortController.signal,
        prepareStep: ({ stepNumber }: { stepNumber: number }) => {
          if (activeNames.length < tools.length) {
            return { activeTools: activeNames };
          }
        },
      } as any);

      let timedOut = false;
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        this.report(BusEvents.Element.Data, { step: "stream-timeout", level: "warn", stepCount: this.#stepCounter.count });
        abortController.abort();
      }, STREAM_TIMEOUT_MS);

      const COMPLETE_MARKER = "<<<COMPLETE>>>";
      const MARKER_LEN = COMPLETE_MARKER.length;
      let textBuffer = "";
      let completeDetected = false;

      try {
        for await (const chunk of streamResult.fullStream) {
          const ctype = (chunk as any).type;

          if (ctype === "step-start" || ctype === "start-step") continue;
          if (ctype === "step-finish" || ctype === "finish-step") {
            finishReason = (chunk as any).finishReason ?? "";
            continue;
          }
          if (ctype === "tool-call") {
            const c = chunk as any;
            if (c.toolName === "intent" && !intentData) {
              intentData = intentSignal.value ?? c.input;
            }
            this.report(BusEvents.Element.Data, { step: "tool-call-start", toolName: c.toolName, stepCount: this.#stepCounter.count, args: JSON.stringify(c.input ?? c.args).slice(0, 200) });
            continue;
          }
          if (ctype === "tool-result") {
            const c = chunk as any;
            if (c.toolName === "intent") continue;
            this.report(BusEvents.Element.Data, { step: "tool-call-finish", toolName: c.toolName, stepCount: this.#stepCounter.count, result: JSON.stringify(c.output ?? c.result).slice(0, 300) });
            continue;
          }
          if (ctype === "text-delta") {
            const text = (chunk as any).textDelta ?? (chunk as any).text ?? "";
            if (completeDetected) continue;

            textBuffer += text;
            const markerIdx = textBuffer.indexOf(COMPLETE_MARKER);

            if (markerIdx >= 0) {
              const safe = textBuffer.slice(0, markerIdx);
              if (safe.length > 0) {
                fullText += safe;
                this.report(BusEvents.Transport.Delta, { textDelta: safe });
              }
              completeDetected = true;
              this.report(BusEvents.Element.Data, { step: "complete-marker-detected" });
              textBuffer = "";
              continue;
            }

            if (textBuffer.length > MARKER_LEN * 3) {
              const sendLen = textBuffer.length - MARKER_LEN + 1;
              const safe = textBuffer.slice(0, sendLen);
              fullText += safe;
              this.report(BusEvents.Transport.Delta, { textDelta: safe });
              textBuffer = textBuffer.slice(-MARKER_LEN);
            }
            continue;
          }
          if (ctype === "finish") {
            finishReason = (chunk as any).finishReason ?? finishReason;
            continue;
          }
          this.report(BusEvents.Element.Data, { step: "unhandled-chunk", type: ctype, raw: JSON.stringify(chunk).slice(0, 200) });
        }
      } finally {
        clearTimeout(timeoutTimer);
      }

      if (!completeDetected && textBuffer.length > 0) {
        fullText += textBuffer;
        this.report(BusEvents.Transport.Delta, { textDelta: textBuffer });
      }

      this.report(BusEvents.Element.Data, { step: "stream-loop-ended", timedOut, finishReason: finishReason || "natural", stepCount: this.#stepCounter.count, fullTextLen: fullText.length });

      tokenOverflow = !timedOut && this.#stepCounter.count === 0 && fullText.length === 0;

      const intents: IntentRequest[] = intentData ? [toIntentRequest(intentData)] : [];

      let response: any;
      let usage: any;

      try {
        response = await Promise.race([
          streamResult.response,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("streamResult.response timeout")), 30_000)
          ),
        ]);
      } catch (err: any) {
        this.report(BusEvents.Element.Data, { step: "response-error", level: "warn", error: err?.message ?? String(err) });
        response = { messages: [] };
        if (!finishReason) finishReason = "error";
      }

      try {
        usage = await Promise.race([
          streamResult.usage,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("streamResult.usage timeout")), 30_000)
          ),
        ]);
      } catch (err: any) {
        this.report(BusEvents.Element.Data, { step: "usage-error", level: "warn", error: err?.message ?? String(err) });
        usage = { totalTokens: 0 };
        if (!finishReason) finishReason = "error";
      }

      const reasoningContent = (response.messages as any[])?.find((m: any) =>
        m.role === "assistant" && m.reasoningContent
      )?.reasoningContent ?? "";
      const tokenUsage: TokenUsage = { total: usage?.totalTokens ?? 0 };
      this.report(BusEvents.Element.Data, { step: "done", outputLen: fullText.length, tokens: tokenUsage.total, hasIntents: intents.length > 0, finishReason, stepCount: this.#stepCounter.count, maxSteps: this.#maxSteps });

      if (this.#stepCounter.count >= this.#maxSteps) {
        this.report(BusEvents.Element.Data, { step: "maxSteps-exhausted", level: "warn", stepCount: this.#stepCounter.count, maxSteps: this.#maxSteps });
      }

      const chainAction = completeDetected ? undefined
        : intents.some(i => i.request === IntentRequestType.FOLLOW_UP) ? "follow_up"
        : intents.some(i => i.request === IntentRequestType.FOLLOW_UP) ? "follow_up"
        : finishReason === "length" ? "follow_up"
        : finishReason === "tool-calls" ? "follow_up"
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
        tokenOverflow,
      };
    } catch (err: any) {
      this.report(BusEvents.Element.Data, { step: "error", level: "warn", error: err?.message ?? String(err) });
      if (fullText.length > 0) {
        return {
          ...input,
          mode: "executing",
          responseText: fullText,
          reasoningContent: "",
          tokenUsage: { total: 0 },
          intents: [],
          chainAction: "follow_up",
          tokenOverflow: false,
        };
      }
      return {
        ...input,
        mode: "executing",
        responseText: `Error: ${err?.message ?? String(err)}`,
        tokenOverflow,
      };
    }
  }
}

function buildAllAiTools(tools: ToolDefinition[], report: (event: string, payload: Record<string, unknown>) => void, stepCounter: { count: number }, session?: any): Record<string, any> {
  const result: Record<string, any> = {};
  for (const t of tools) {
    result[t.name] = tool({
      description: t.description,
      parameters: jsonSchema(t.inputSchema as any),
      execute: t.name === "intent"
        ? async () => "Intent received"
        : async (args: any, opts?: any) => {
            const sc = ++stepCounter.count;
            const start = Date.now();
            try {
              report(BusEvents.Element.Data, { step: "tool-execute-start", toolName: t.name, stepCount: sc, args: JSON.stringify(args).slice(0, 200) });
              const r = await t.execute(args, { abortSignal: opts?.abortSignal });
              const duration = Date.now() - start;
              report(BusEvents.Element.Data, { step: "tool-execute-done", toolName: t.name, stepCount: sc, duration, ok: r.ok });
              if (t.name === "todowrite" && r.ok && session?.setTodoState) {
                session.setTodoState((args as any).todos ?? []);
              }
              if (!r.ok) return `Error: ${r.error}`;
              return r.output || JSON.stringify(r.data);
            } catch (err: any) {
              const duration = Date.now() - start;
              report(BusEvents.Element.Data, { step: "tool-execute-error", toolName: t.name, stepCount: sc, duration, error: err?.message ?? String(err) });
              return `Tool execution error: ${err?.message ?? String(err)}`;
            }
          },
    });
  }
  return result;
}

function getActiveToolNames(taskIntent: string): string[] {
  const FS_RO = ["read", "grep", "ls", "tree", "glob"];
  const FS_RW = ["write", "edit", "cp", "mv"];
  const MEMORY = ["search_memory", "save_memory", "link_memory", "traverse_memory"];
  const CONTROL = ["todowrite", "intent"];
  const EXTRA = ["webfetch", "bash"];

  switch (taskIntent) {
    case "instruction":
      return [...FS_RO, ...FS_RW, ...MEMORY, ...CONTROL, ...EXTRA];
    case "question":
      return [...FS_RO, ...MEMORY, ...CONTROL, "webfetch"];
    case "creative":
      return [...FS_RO, ...FS_RW, ...CONTROL, "webfetch"];
    case "conversation":
    default:
      return [...FS_RO, ...CONTROL, "webfetch"];
  }
}

function resolveTimeout(difficulty: string): number {
  switch (difficulty) {
    case "mygod": return 1_800_000;
    case "hard":  return 900_000;
    case "medium": return 600_000;
    default:      return 300_000;
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
