import { areMemorySearchQueriesSimilar, BaseElement, canonicalizeMemorySearchQuery, containsSkillHint, sanitizeForJSON } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { pruneMessages, streamText, tool, zodSchema, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ToolDefinition } from "@atom-neo/shared";
import { BusEvents, IntentRequestType, IntentRequestSource } from "@atom-neo/shared";
import type { IntentRequest } from "@atom-neo/shared";
import type { TokenUsage } from "../../../session/context";
import { DEFAULT_MAX_TOKENS, DEFAULT_CONTEXT_LIMIT } from "../../../constants";
import { IntentInputSchema } from "../../../tools/builtin/intent";
import type { IntentToolInput } from "../../../tools/builtin/intent";
import type { ConversationFlowState, MemorySearchStatus } from "./types";
import { calcTokenUsage, calcTokenRatio } from "../../shared";

type WebfetchUnlockReason =
  | "explicit_url"
  | "skill_context"
  | "memory_found"
  | "memory_unavailable"
  | "memory_read_unavailable"
  | "memory_read_required"
  | "skill_unavailable"
  | "skill_load_required"
  | "memory_search_exhausted"
  | "memory_search_retry_required"
  | "memory_search_required";

type ActiveToolSelection = {
  activeTools: string[];
  webfetchEnabled: boolean;
  webfetchUnlockReason: WebfetchUnlockReason;
};

export function containsExplicitUrl(messages: Array<{ role: string; content: string }>): boolean {
  const latestUserText = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  return /https?:\/\/\S+/i.test(latestUserText);
}

type MemorySearchStep = {
  toolResults?: Array<{ toolName: string; input: unknown; output: unknown }>;
};

export function pruneConsumedMemoryTraversal(messages: ModelMessage[]): ModelMessage[] {
  return pruneMessages({
    messages,
    toolCalls: [{ type: "before-last-2-messages", tools: ["traverse_memory"] }],
    emptyMessages: "remove",
  });
}

export function shouldPersistToolResult(toolName: string): boolean {
  return toolName !== "traverse_memory";
}

export function summarizeMemorySearch(params: {
  automaticQuery: string;
  automaticStatus: MemorySearchStatus;
  steps: MemorySearchStep[];
}): { attemptCount: number; found: boolean; unavailable: boolean } {
  const queries: string[] = [];
  let found = params.automaticStatus === "found";
  let unavailable = params.automaticStatus === "unavailable";

  const addDistinctQuery = (query: string) => {
    const canonicalQuery = canonicalizeMemorySearchQuery(query);
    if (canonicalQuery && !queries.some((existing) => areMemorySearchQueriesSimilar(existing, canonicalQuery))) {
      queries.push(canonicalQuery);
    }
  };

  if (params.automaticStatus !== "not_started" && params.automaticQuery.trim()) {
    addDistinctQuery(params.automaticQuery);
  }

  for (const step of params.steps) {
    for (const result of step.toolResults ?? []) {
      if (result.toolName !== "search_memory") continue;
      const input = result.input as { query?: unknown } | null;
      if (typeof input?.query === "string") addDistinctQuery(input.query);

      const output = typeof result.output === "string" ? result.output : "";
      if (output.includes("<MemorySummary id=")) found = true;
      if (/memory service not connected|^Error:|tool execution error/i.test(output)) unavailable = true;
    }
  }

  return { attemptCount: queries.length, found, unavailable };
}

export function summarizeMemoryRead(steps: MemorySearchStep[]): { read: boolean; unavailable: boolean; suggestsSkill: boolean } {
  let read = false;
  let unavailable = false;
  let suggestsSkill = false;
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (result.toolName !== "read_memory") continue;
      const output = typeof result.output === "string" ? result.output : "";
      if (output.includes("<Memory id=")) {
        read = true;
        suggestsSkill = containsSkillHint(output);
      }
      if (/^Error:|memory service not connected|tool execution error/i.test(output)) unavailable = true;
    }
  }
  return { read, unavailable, suggestsSkill };
}

export function summarizeSkillDiscovery(steps: MemorySearchStep[]): { loaded: boolean; unavailable: boolean } {
  let loaded = false;
  let unavailable = false;
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (result.toolName !== "skill_load" && result.toolName !== "skill_section") continue;
      const output = typeof result.output === "string" ? result.output : "";
      if (/^Loaded (?:skill|section) /i.test(output)) loaded = true;
      if (/^Error:|not found|tool execution error/i.test(output)) unavailable = true;
    }
  }
  return { loaded, unavailable };
}

export function selectActiveToolsForStep(params: {
  taskIntent: string;
  availableToolNames: string[];
  mcpToolNames: string[];
  memorySearchAttemptCount: number;
  memorySearchFound: boolean;
  memorySearchUnavailable: boolean;
  memoryRead: boolean;
  memoryReadUnavailable: boolean;
  memorySuggestsSkill: boolean;
  hasSkillContext: boolean;
  skillLoaded: boolean;
  skillUnavailable: boolean;
  hasExplicitUrl: boolean;
}): ActiveToolSelection {
  let webfetchUnlockReason: WebfetchUnlockReason;
  if (params.hasExplicitUrl) webfetchUnlockReason = "explicit_url";
  else if (params.hasSkillContext || params.skillLoaded) webfetchUnlockReason = "skill_context";
  else if (params.memoryRead && params.memorySuggestsSkill) {
    webfetchUnlockReason = params.skillUnavailable ? "skill_unavailable" : "skill_load_required";
  } else if (params.memoryRead) webfetchUnlockReason = "memory_found";
  else if (params.memoryReadUnavailable) webfetchUnlockReason = "memory_read_unavailable";
  else if (params.memorySearchUnavailable) webfetchUnlockReason = "memory_unavailable";
  else if (params.memorySearchAttemptCount >= 3) webfetchUnlockReason = "memory_search_exhausted";
  else if (params.memorySearchFound) webfetchUnlockReason = "memory_read_required";
  else if (params.memorySearchAttemptCount > 0) webfetchUnlockReason = "memory_search_retry_required";
  else webfetchUnlockReason = "memory_search_required";
  const webfetchEnabled = webfetchUnlockReason !== "memory_search_required"
    && webfetchUnlockReason !== "memory_search_retry_required"
    && webfetchUnlockReason !== "memory_read_required"
    && webfetchUnlockReason !== "skill_load_required";
  const selected = [
    ...getTaskToolNames(params.taskIntent),
    ...params.mcpToolNames,
    ...(webfetchEnabled ? ["webfetch"] : []),
  ];
  const available = new Set(params.availableToolNames);
  return {
    activeTools: [...new Set(selected)].filter((name) => available.has(name)),
    webfetchEnabled,
    webfetchUnlockReason,
  };
}

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
  #configContextLimit: number;
  #mcpToolsRef?: { current: Record<string, any> };
  #mcpToolNamesCount = 0;
  #builtinToolResults = new Map<string, ToolExecutionStatus[]>();

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    apiKey: string;
    model: string;
    baseUrl?: string;
    tools: ToolDefinition[];
    mcpToolsRef?: { current: Record<string, any> };
    maxTokens?: number;
    maxSteps?: number;
    providerOptions?: Record<string, any>;
    taskIntent?: string;
    session?: any;
    configContextLimit?: number;
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
    this.#configContextLimit = params.configContextLimit ?? DEFAULT_CONTEXT_LIMIT;
    const builtinTools = buildAllAiTools(params.tools, (event, payload) => this.report(event, payload), this.#stepCounter, this.#builtinToolResults, this.#session);
    const mcpCurrent = params.mcpToolsRef?.current ?? {};
    const wrappedMCP = wrapMCPAiTools(mcpCurrent, (event, payload) => this.report(event, payload), this.#stepCounter);
    this.#mcpToolsRef = params.mcpToolsRef;
    this.#mcpToolNamesCount = Object.keys(wrappedMCP).length;
    this.#aiTools = { ...builtinTools, ...wrappedMCP };
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "formatted") return input;
    if (!this.#apiKey) {
      this.report(BusEvents.Element.Data, { step: "no apiKey, fallback" });
      return { ...input, mode: "executing", responseText: "(no API key configured)" };
    }

    const userMessages = input.userMessages ?? [];
    const systemText = input.systemText ?? "";
    const mcpCurrent = this.#mcpToolsRef?.current ?? {};
    if (Object.keys(mcpCurrent).length > this.#mcpToolNamesCount) {
      const wrappedMCP = wrapMCPAiTools(mcpCurrent, (event, payload) => this.report(event, payload), this.#stepCounter);
      this.#mcpToolNamesCount = Object.keys(wrappedMCP).length;
      Object.assign(this.#aiTools, wrappedMCP);
    }
    const tools = Object.keys(this.#aiTools);
    const mcpToolNames = Object.keys(mcpCurrent);
    const hasExplicitUrl = containsExplicitUrl(userMessages);
    const hasSkillContext = Boolean(input.skillContext?.trim());
    const automaticQuery = this.#session?.pendingPrediction?.memoryQuery ?? "";
    const automaticStatus = input.memorySearchStatus ?? "not_started";
    const initialMemorySearch = summarizeMemorySearch({ automaticQuery, automaticStatus, steps: [] });
    const initialToolSelection = selectActiveToolsForStep({
      taskIntent: this.#taskIntent,
      availableToolNames: tools,
      mcpToolNames,
      memorySearchAttemptCount: initialMemorySearch.attemptCount,
      memorySearchFound: initialMemorySearch.found,
      memorySearchUnavailable: initialMemorySearch.unavailable,
      memoryRead: false,
      memoryReadUnavailable: false,
      memorySuggestsSkill: false,
      hasSkillContext,
      skillLoaded: false,
      skillUnavailable: false,
      hasExplicitUrl,
    });
    this.#builtinToolResults.clear();
    this.report(BusEvents.Element.Data, {
      step: "starting LLM call",
      model: this.#model,
      msgCount: userMessages.length,
      toolCount: tools.length,
      activeCount: initialToolSelection.activeTools.length,
      taskIntent: this.#taskIntent,
      memoryQuery: automaticQuery,
      memorySearchAttempted: input.memorySearchAttempted ?? false,
      memorySearchStatus: automaticStatus,
      memorySearchAttemptCount: initialMemorySearch.attemptCount,
      injectedMemoryCount: input.injectedMemoryCount ?? 0,
      memoryRead: false,
      webfetchEnabled: initialToolSelection.webfetchEnabled,
      webfetchUnlockReason: initialToolSelection.webfetchUnlockReason,
    });

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
      let reasoningText = "";
      let intentData: IntentToolInput | null = null;
      let finishReason = "";
      let tokenOverflow = false;
      let streamErrorCode = 0;
      const allToolCalls: { toolName: string; ok: boolean }[] = [];

      try {
        const difficulty = this.#session?.pendingPrediction?.difficulty ?? "medium";
        const STREAM_TIMEOUT_MS = resolveTimeout(difficulty);
        const abortController = new AbortController();
        let reportedToolSelection = "";

        const streamResult = streamText({
        model,
        system: systemText || undefined,
        messages: userMessages as any,
        tools: tools.length > 0 ? this.#aiTools : undefined,
        stopWhen: stepCountIs(this.#maxSteps),
        maxOutputTokens: this.#maxTokens,
        providerOptions: this.#providerOptions,
        abortSignal: abortController.signal,
        prepareStep: ({ stepNumber, steps, messages }) => {
          const memorySearch = summarizeMemorySearch({ automaticQuery, automaticStatus, steps });
          const memoryRead = summarizeMemoryRead(steps);
          const skillDiscovery = summarizeSkillDiscovery(steps);
          const selection = selectActiveToolsForStep({
            taskIntent: this.#taskIntent,
            availableToolNames: tools,
            mcpToolNames,
            memorySearchAttemptCount: memorySearch.attemptCount,
            memorySearchFound: memorySearch.found,
            memorySearchUnavailable: memorySearch.unavailable,
            memoryRead: memoryRead.read,
            memoryReadUnavailable: memoryRead.unavailable,
            memorySuggestsSkill: memoryRead.suggestsSkill,
            hasSkillContext,
            skillLoaded: skillDiscovery.loaded,
            skillUnavailable: skillDiscovery.unavailable,
            hasExplicitUrl,
          });
          const selectionKey = `${selection.webfetchEnabled}:${selection.webfetchUnlockReason}`;
          if (selectionKey !== reportedToolSelection) {
            reportedToolSelection = selectionKey;
            this.report(BusEvents.Element.Data, {
              step: "tool-policy",
              stepNumber,
              activeCount: selection.activeTools.length,
              memorySearchAttemptCount: memorySearch.attemptCount,
              memorySearchFound: memorySearch.found,
              memorySearchUnavailable: memorySearch.unavailable,
              memoryRead: memoryRead.read,
              memoryReadUnavailable: memoryRead.unavailable,
              memorySuggestsSkill: memoryRead.suggestsSkill,
              skillLoaded: skillDiscovery.loaded,
              skillUnavailable: skillDiscovery.unavailable,
              webfetchEnabled: selection.webfetchEnabled,
              webfetchUnlockReason: selection.webfetchUnlockReason,
            });
          }
          return {
            activeTools: selection.activeTools,
            messages: pruneConsumedMemoryTraversal(messages),
          };
        },
      });

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
        let stepToolCalls: { toolName: string; ok: boolean }[] = [];
        for await (const chunk of streamResult.fullStream) {
          const pt = (chunk as any).type;

          if (pt === "start" || pt === "source" || pt === "raw" || pt === "object"
            || pt === "response-metadata" || pt === "message-metadata") continue;

          if (pt !== "tool-call" && pt !== "tool-result" && stepToolCalls.length > 0) {
            const success = stepToolCalls.filter(t => t.ok).length;
            const failed = stepToolCalls.length - success;
            this.report(BusEvents.Transport.ToolStepFinished as any, {
              stepNumber: this.#stepCounter.count,
              total: stepToolCalls.length,
              success,
              failed,
              toolNames: stepToolCalls.map(t => t.toolName),
            });
            stepToolCalls = [];
          }

          if (pt === "reasoning-delta" || pt === "reasoning") {
            const text = (chunk as any).textDelta ?? (chunk as any).text ?? "";
            if (text) {
              const offset = reasoningText.length;
              reasoningText += text;
              this.report(BusEvents.Transport.Reason as any, { textDelta: text, offset });
            }
            continue;
          }

          if (pt === "text-delta") {
            const text = (chunk as any).text ?? "";
            if (completeDetected) continue;

            textBuffer += text;
            const markerIdx = textBuffer.indexOf(COMPLETE_MARKER);

            if (markerIdx >= 0) {
              const safe = textBuffer.slice(0, markerIdx);
              if (safe.length > 0) {
                const offset = fullText.length;
                fullText += safe;
                this.report(BusEvents.Transport.Delta, { textDelta: safe, offset });
              }
              completeDetected = true;
              this.report(BusEvents.Element.Data, { step: "complete-marker-detected" });
              textBuffer = "";
              continue;
            }

            if (textBuffer.length > MARKER_LEN * 3) {
              const sendLen = textBuffer.length - MARKER_LEN + 1;
              const safe = textBuffer.slice(0, sendLen);
              const offset = fullText.length;
              fullText += safe;
              this.report(BusEvents.Transport.Delta, { textDelta: safe, offset });
              textBuffer = textBuffer.slice(-(MARKER_LEN - 1));
            }
            continue;
          }

          if (pt === "tool-call") {
            const c = chunk as any;
            if (c.toolName === "intent" && !intentData) {
              intentData = intentSignal.value ?? c.input;
            }
            this.report(BusEvents.Element.Data, { step: "tool-call-start", toolName: c.toolName, stepCount: this.#stepCounter.count, args: JSON.stringify(c.input ?? c.args).slice(0, 200) });
            this.report(BusEvents.Transport.ToolStarted as any, { toolName: c.toolName, toolCallId: c.toolCallId ?? "", input: c.input });
            continue;
          }

          if (pt === "tool-result") {
            const c = chunk as any;
            if (c.toolName === "intent") continue;
            const status = takeToolExecutionStatus(this.#builtinToolResults, c.toolName);
            const rawResult = c.output ?? c.result;
            const toolOutput = String(c.output ?? c.result ?? status?.output ?? "");
            const toolError = c.error ?? status?.error;
            const toolOk = status?.ok ?? !toolError;
            const resultPreview = rawResult === undefined ? "" : JSON.stringify(rawResult).slice(0, 300);
            this.report(BusEvents.Element.Data, { step: "tool-call-finish", toolName: c.toolName, stepCount: this.#stepCounter.count, result: resultPreview, ok: toolOk, error: toolError });
            this.report(BusEvents.Transport.ToolFinished as any, { toolName: c.toolName, toolCallId: c.toolCallId ?? "", result: rawResult, error: toolError });
            stepToolCalls.push({ toolName: c.toolName, ok: toolOk });
            allToolCalls.push({ toolName: c.toolName, ok: toolOk });
            if (shouldPersistToolResult(c.toolName) && this.#session?.addToolResult) {
              this.#session.addToolResult({
                toolName: c.toolName,
                topic: this.#session.currentTopic ?? "",
                timestamp: Date.now(),
                ok: toolOk,
                output: toolOutput,
                error: toolError,
              });
            }
            continue;
          }

          if (pt === "finish") {
            finishReason = (chunk as any).finishReason ?? finishReason;
            continue;
          }

          if (pt === "error") {
            const err = (chunk as any).error ?? {};
            if (err.statusCode) streamErrorCode = err.statusCode;
            this.report(BusEvents.Element.Data, { step: "stream-llm-error", errorName: err.name, statusCode: err.statusCode, message: (err.message ?? "").slice(0, 500), responseBody: (err.responseBody ?? "").slice(0, 500) });
            continue;
          }

          if (pt === "abort") {
            this.report(BusEvents.Element.Data, { step: "abort", level: "warn" });
            continue;
          }
        }
      } finally {
        clearTimeout(timeoutTimer);
      }

      if (!completeDetected && textBuffer.length > 0) {
        const offset = fullText.length;
        fullText += textBuffer;
        this.report(BusEvents.Transport.Delta, { textDelta: textBuffer, offset });
      }

      this.report(BusEvents.Element.Data, { step: "stream-loop-ended", timedOut, finishReason: finishReason || "natural", stepCount: this.#stepCounter.count, fullTextLen: fullText.length });

      if (allToolCalls.length > 0) {
        const uniqueNames = [...new Set(allToolCalls.map(t => t.toolName))];
        const success = allToolCalls.filter(t => t.ok).length;
        this.report(BusEvents.Transport.ToolGroupComplete as any, {
          total: allToolCalls.length,
          success,
          failed: allToolCalls.length - success,
          toolNames: uniqueNames,
        });
      }

      tokenOverflow = !timedOut && this.#stepCounter.count === 0 && fullText.length === 0;

      if (tokenOverflow) {
        const tu = this.#session?.contextTokens ?? 0;
        const ratio = calcTokenRatio(tu, this.#configContextLimit, this.#maxTokens);
        const effectiveLimit = this.#configContextLimit - this.#maxTokens;

        if (ratio <= 0.8) {
          tokenOverflow = false;
          this.report(BusEvents.Element.Data, { step: "stream-error-not-overflow", ratio: +ratio.toFixed(3), tu, effectiveLimit });
        } else {
          this.report(BusEvents.Element.Data, { step: "token-overflow-detected", taskIntent: this.#taskIntent, msgCount: userMessages.length, toolCount: tools.length, ratio: +ratio.toFixed(3), tu, effectiveLimit });
          return {
            ...input,
            mode: "executing",
            responseText: "",
            reasoningContent: "",
            tokenUsage: { total: 0 },
            intents: [],
            tokenOverflow: true,
          };
        }
      }

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

      const reasoningContent = reasoningText;
      const tokenUsage: TokenUsage = { total: usage?.totalTokens ?? 0 };
      if (this.#session?.setContextTokens) {
        this.#session.setContextTokens(usage?.totalTokens ?? 0);
      }

      fullText = sanitizeForJSON(fullText);
      this.report(BusEvents.Element.Data, { step: "done", outputLen: fullText.length, tokens: tokenUsage.total, hasIntents: intents.length > 0, finishReason, stepCount: this.#stepCounter.count, maxSteps: this.#maxSteps });

      if (this.#stepCounter.count >= this.#maxSteps) {
        this.report(BusEvents.Element.Data, { step: "maxSteps-exhausted", level: "warn", stepCount: this.#stepCounter.count, maxSteps: this.#maxSteps });
      }

      const chainAction = completeDetected ? undefined
        : intents.some(i => i.request === IntentRequestType.FOLLOW_UP) ? "follow_up"
        : finishReason === "length" ? "follow_up"
        : finishReason === "error" && streamErrorCode < 400 ? "follow_up"
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
        errorStatusCode: streamErrorCode,
      };
    } catch (err: any) {
      this.report(BusEvents.Element.Data, { step: "error", level: "warn", error: err?.message ?? String(err) });
      if (fullText.length > 0) {
        return {
          ...input,
          mode: "executing",
          responseText: sanitizeForJSON(fullText),
          reasoningContent: "",
          tokenUsage: { total: 0 },
          intents: [],
          chainAction: "follow_up",
          tokenOverflow: false,
          errorStatusCode: err.statusCode ?? 0,
        };
      }
      return {
        ...input,
        mode: "executing",
        responseText: sanitizeForJSON(`Error: ${err?.message ?? String(err)}`),
        tokenOverflow,
        errorStatusCode: err.statusCode ?? 0,
      };
    }
  }
}

type ToolExecutionStatus = {
  ok: boolean;
  output: string;
  error?: string;
};

function pushToolExecutionStatus(
  store: Map<string, ToolExecutionStatus[]>,
  toolName: string,
  status: ToolExecutionStatus,
): void {
  const queue = store.get(toolName) ?? [];
  queue.push(status);
  store.set(toolName, queue);
}

function takeToolExecutionStatus(
  store: Map<string, ToolExecutionStatus[]>,
  toolName: string,
): ToolExecutionStatus | undefined {
  const queue = store.get(toolName);
  if (!queue || queue.length === 0) return undefined;
  const status = queue.shift();
  if (queue.length === 0) store.delete(toolName);
  return status;
}

function buildAllAiTools(
  tools: ToolDefinition[],
  report: (event: string, payload: Record<string, unknown>) => void,
  stepCounter: { count: number },
  toolResults: Map<string, ToolExecutionStatus[]>,
  session?: any,
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const t of tools) {
    result[t.name] = (tool as any)({
      description: t.description,
      inputSchema: zodSchema(t.inputSchema),
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
              const output = r.output || (r.data === undefined ? "" : JSON.stringify(r.data));
              pushToolExecutionStatus(toolResults, t.name, { ok: r.ok, output, error: r.error });
              if (t.name === "todowrite" && r.ok && session?.setTodoState) {
                session.setTodoState((args as any).todos ?? []);
              }
              if (!r.ok) return `Error: ${r.error}`;
              return output;
            } catch (err: any) {
              const duration = Date.now() - start;
              const error = err?.message ?? String(err);
              report(BusEvents.Element.Data, { step: "tool-execute-error", toolName: t.name, stepCount: sc, duration, error });
              pushToolExecutionStatus(toolResults, t.name, { ok: false, output: "", error });
              return `Tool execution error: ${error}`;
            }
          },
    });
  }
  return result;
}

function wrapMCPAiTools(mcpTools: Record<string, any>, report: (event: string, payload: Record<string, unknown>) => void, stepCounter: { count: number }): Record<string, any> {
  const wrapped: Record<string, any> = {};
  for (const [name, t] of Object.entries(mcpTools)) {
    const origExecute = (t as any).execute;
    if (typeof origExecute !== "function") {
      wrapped[name] = t;
      continue;
    }
    wrapped[name] = {
      ...t as any,
      execute: async (args: any, opts?: any) => {
        const sc = ++stepCounter.count;
        const start = Date.now();
        try {
          report(BusEvents.Element.Data, { step: "tool-execute-start", toolName: name, stepCount: sc, source: "mcp", args: JSON.stringify(args).slice(0, 200) });
          const result = await origExecute(args, opts);
          const duration = Date.now() - start;
          report(BusEvents.Element.Data, { step: "tool-execute-done", toolName: name, stepCount: sc, source: "mcp", duration });
          return result;
        } catch (err: any) {
          const duration = Date.now() - start;
          report(BusEvents.Element.Data, { step: "tool-execute-error", toolName: name, stepCount: sc, source: "mcp", duration, error: err?.message ?? String(err) });
          return `MCP tool error: ${err?.message ?? String(err)}`;
        }
      },
    };
  }
  return wrapped;
}

function getTaskToolNames(taskIntent: string): string[] {
  const FS_RO = ["read", "grep", "ls", "tree", "glob"];
  const FS_RW = ["write", "edit", "cp", "mv"];
  const MEMORY = ["search_memory", "read_memory", "save_memory", "forget_memory", "link_memory", "traverse_memory"];
  const MEMORY_DISCOVERY = ["search_memory", "read_memory"];
  const SKILL = ["skill_list", "skill_load", "skill_section", "skill_remove_section", "skill_unload"];
  const CONTROL = ["todowrite", "intent"];
  const SCHEDULE = ["schedule_create", "schedule_list", "schedule_update", "schedule_cancel"];

  switch (taskIntent) {
    case "instruction":
      return [...FS_RO, ...FS_RW, ...MEMORY, ...SKILL, ...CONTROL, "bash", ...SCHEDULE];
    case "question":
      return [...FS_RO, ...MEMORY, ...SKILL, ...CONTROL, ...SCHEDULE];
    case "creative":
      return [...FS_RO, ...FS_RW, ...MEMORY_DISCOVERY, ...SKILL, ...CONTROL, ...SCHEDULE];
    case "conversation":
    default:
      return [...FS_RO, ...MEMORY_DISCOVERY, ...SKILL, ...CONTROL, ...SCHEDULE];
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
    case "retain_memory":
      return { source: IntentRequestSource.CONVERSATION, request: IntentRequestType.RETAIN_MEMORY, intent: "retain", params: { id: input.mem_id } };
    default:
      return { source: IntentRequestSource.CONVERSATION, request: IntentRequestType.FOLLOW_UP, intent: "follow up", params: input };
  }
}
