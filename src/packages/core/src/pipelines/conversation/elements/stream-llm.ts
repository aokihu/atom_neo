import { areMemorySearchQueriesSimilar, BaseElement, canonicalizeMemorySearchQuery, containsSkillHint, sanitizeForJSON, substringWellFormed } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { isStepCount, pruneMessages, streamText, tool, zodSchema } from "ai";
import type { ModelMessage } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ToolContextInjection, ToolDefinition, ToolGuardState } from "@atom-neo/shared";
import { BusEvents, IntentRequestType, IntentRequestSource } from "@atom-neo/shared";
import type { IntentRequest } from "@atom-neo/shared";
import type { TokenUsage } from "../../../session/context";
import { DEFAULT_MAX_TOKENS, DEFAULT_CONTEXT_LIMIT } from "../../../constants";
import { IntentInputSchema } from "../../../tools/builtin/intent";
import type { IntentToolInput } from "../../../tools/builtin/intent";
import type { ConversationFlowState, MemorySearchStatus } from "./types";
import { calcTokenUsage, calcTokenRatio } from "../../shared";
import type { SkillServiceLike } from "../../../skills/types";
import type { ContextService } from "../../../context/context-service";
import {
  formatToolGovernanceBlock,
  ToolCallLedger,
} from "../../../tools/governance";
import type { ToolCallDecision } from "../../../tools/governance";

type WebfetchGuardReason =
  | "explicit_url"
  | "skill_context"
  | "memory_found"
  | "memory_unavailable"
  | "memory_read_unavailable"
  | "skill_unavailable"
  | "capability_discovery_complete"
  | "memory_review_required"
  | "skill_search_required"
  | "skill_load_required"
  | "memory_search_required";

type ActiveToolSelection = {
  activeTools: string[];
  webfetchAllowed: boolean;
  webfetchGuardReason: WebfetchGuardReason;
  webfetchGuardMessage?: string;
};

function resolveWebfetchGuardMessage(reason: WebfetchGuardReason): string | undefined {
  switch (reason) {
    case "memory_search_required":
      return "Call search_memory with the task's core concept, then retry webfetch.";
    case "memory_review_required":
      return "Memory candidates exist. Call read_memory for a relevant candidate; if none is relevant, call skill_list, then retry webfetch.";
    case "skill_search_required":
      return "Memory has no usable result. Call skill_list, then retry webfetch if no relevant Skill exists.";
    case "skill_load_required":
      return "Memory points to a Skill. Call skill_load or skill_section, then retry webfetch.";
  }
}

function canExecuteWebfetch(reason: WebfetchGuardReason): boolean {
  switch (reason) {
    case "explicit_url":
    case "skill_context":
    case "memory_found":
    case "memory_unavailable":
    case "memory_read_unavailable":
    case "skill_unavailable":
    case "capability_discovery_complete":
      return true;
    default:
      return false;
  }
}

function toWebfetchGuardState(selection: ActiveToolSelection): ToolGuardState {
  return {
    webfetch: {
      allowed: selection.webfetchAllowed,
      reason: selection.webfetchGuardReason,
      ...(selection.webfetchGuardMessage ? { message: selection.webfetchGuardMessage } : {}),
    },
  };
}

export function resolveModelInput(input: Pick<
  ConversationFlowState,
  "contextSnapshot" | "systemText" | "userMessages"
>) {
  return {
    systemText: input.contextSnapshot?.content ?? input.systemText ?? "",
    userMessages: input.userMessages ?? [],
  };
}

export function containsExplicitUrl(messages: ReadonlyArray<{ role: string; content: string }>): boolean {
  const latestUserText = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  return /https?:\/\/\S+/i.test(latestUserText);
}

type MemorySearchStep = {
  toolResults?: Array<{ toolName: string; input: unknown; output: unknown }>;
};

export function resolveTokenMetrics(
  usage?: { totalTokens?: number },
  totalUsage?: { totalTokens?: number },
): { contextTokens: number; totalUsageTokens: number } {
  const contextTokens = usage?.totalTokens ?? 0;
  return {
    contextTokens,
    totalUsageTokens: totalUsage?.totalTokens ?? contextTokens,
  };
}

export function pruneConsumedTransientTools(messages: ModelMessage[]): ModelMessage[] {
  return pruneMessages({
    messages,
    toolCalls: [{
      type: "before-last-2-messages",
      tools: ["traverse_memory", "search_history", "read_history"],
    }],
    emptyMessages: "remove",
  });
}

export function shouldPersistToolResult(toolName: string): boolean {
  return toolName !== "traverse_memory"
    && toolName !== "search_history"
    && toolName !== "read_history";
}

export function injectToolContext(params: {
  contextService: ContextService;
  injection: ToolContextInjection;
  sessionId: string;
  topicId?: string;
  contextOwner?: ConversationFlowState["contextOwner"];
  stepId?: string;
}): ToolContextInjection["scope"] {
  const scope = params.injection.scope === "topic" && !params.topicId
    ? "session"
    : params.injection.scope;
  const owner = scope === "session"
    ? { sessionId: params.sessionId }
    : scope === "topic"
      ? { sessionId: params.sessionId, topicId: params.topicId }
      : {
          ...params.contextOwner,
          ...(scope === "step" ? { stepId: params.stepId } : {}),
        };
  params.contextService.put({ ...params.injection, scope, owner });
  return scope;
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

export function summarizeSkillDiscovery(steps: MemorySearchStep[]): { checked: boolean; loaded: boolean; unavailable: boolean } {
  let checked = false;
  let loaded = false;
  let unavailable = false;
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (result.toolName === "skill_list") checked = true;
      if (result.toolName !== "skill_load" && result.toolName !== "skill_section") continue;
      const output = typeof result.output === "string" ? result.output : "";
      if (/^Loaded (?:skill|section) /i.test(output)) loaded = true;
      if (/^Error:|not found|tool execution error/i.test(output)) unavailable = true;
    }
  }
  return { checked, loaded, unavailable };
}

export function selectActiveToolsForStep(params: {
  availableToolNames: string[];
  memorySearchAttemptCount: number;
  memorySearchFound: boolean;
  memorySearchUnavailable: boolean;
  memoryRead: boolean;
  memoryReadUnavailable: boolean;
  memorySuggestsSkill: boolean;
  hasSkillContext: boolean;
  skillChecked: boolean;
  skillLoaded: boolean;
  skillUnavailable: boolean;
  hasExplicitUrl: boolean;
}): ActiveToolSelection {
  let webfetchGuardReason: WebfetchGuardReason;
  if (params.hasExplicitUrl) webfetchGuardReason = "explicit_url";
  else if (params.hasSkillContext || params.skillLoaded) webfetchGuardReason = "skill_context";
  else if (params.memoryRead && params.memorySuggestsSkill) {
    webfetchGuardReason = params.skillUnavailable ? "skill_unavailable" : "skill_load_required";
  } else if (params.memoryRead) webfetchGuardReason = "memory_found";
  else if (params.memoryReadUnavailable) webfetchGuardReason = "memory_read_unavailable";
  else if (params.memorySearchUnavailable) webfetchGuardReason = "memory_unavailable";
  else if (params.memorySearchFound && params.skillChecked) webfetchGuardReason = "capability_discovery_complete";
  else if (params.memorySearchFound) webfetchGuardReason = "memory_review_required";
  else if (params.memorySearchAttemptCount > 0 && params.skillChecked) webfetchGuardReason = "capability_discovery_complete";
  else if (params.memorySearchAttemptCount > 0) webfetchGuardReason = "skill_search_required";
  else webfetchGuardReason = "memory_search_required";
  const webfetchGuardMessage = resolveWebfetchGuardMessage(webfetchGuardReason);
  const webfetchAllowed = canExecuteWebfetch(webfetchGuardReason);
  return {
    activeTools: [...new Set(params.availableToolNames)],
    webfetchAllowed,
    webfetchGuardReason,
    ...(webfetchGuardMessage ? { webfetchGuardMessage } : {}),
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
  #toolResults = new Map<string, ToolExecutionStatus[]>();
  #toolGuardState = { current: {} as ToolGuardState };
  #toolGovernance: { current: ToolCallLedger };
  #skillService?: SkillServiceLike;
  #contextService: ContextService;

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
    skillService?: SkillServiceLike;
    contextService: ContextService;
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
    this.#skillService = params.skillService;
    this.#contextService = params.contextService;
    this.#toolGovernance = { current: new ToolCallLedger({ maxExecutions: this.#maxSteps }) };
    const builtinTools = buildAllAiTools(params.tools, (event, payload) => this.report(event, payload), this.#stepCounter, this.#toolResults, this.#toolGuardState, this.#toolGovernance, this.#session);
    const mcpCurrent = params.mcpToolsRef?.current ?? {};
    const wrappedMCP = wrapMCPAiTools(mcpCurrent, (event, payload) => this.report(event, payload), this.#stepCounter, this.#toolResults, this.#toolGovernance);
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
    const reportTransport = (eventName: string, payload: Record<string, unknown>) => {
      this.report(eventName, {
        sessionId: input.task.sessionId,
        taskId: input.task.id,
        ...payload,
      });
    };

    const { userMessages, systemText } = resolveModelInput(input);
    this.#toolGovernance.current = new ToolCallLedger({ maxExecutions: this.#maxSteps });
    const mcpCurrent = this.#mcpToolsRef?.current ?? {};
    if (Object.keys(mcpCurrent).length > this.#mcpToolNamesCount) {
      const wrappedMCP = wrapMCPAiTools(mcpCurrent, (event, payload) => this.report(event, payload), this.#stepCounter, this.#toolResults, this.#toolGovernance);
      this.#mcpToolNamesCount = Object.keys(wrappedMCP).length;
      Object.assign(this.#aiTools, wrappedMCP);
    }
    const tools = Object.keys(this.#aiTools);
    const hasExplicitUrl = containsExplicitUrl(userMessages);
    const hasSkillContext = Boolean(input.skillContext?.trim());
    const automaticQuery = this.#session?.pendingPrediction?.memoryQuery ?? "";
    const automaticStatus = input.memorySearchStatus ?? "not_started";
    const initialMemorySearch = summarizeMemorySearch({ automaticQuery, automaticStatus, steps: [] });
    const initialToolSelection = selectActiveToolsForStep({
      availableToolNames: tools,
      memorySearchAttemptCount: initialMemorySearch.attemptCount,
      memorySearchFound: initialMemorySearch.found,
      memorySearchUnavailable: initialMemorySearch.unavailable,
      memoryRead: false,
      memoryReadUnavailable: false,
      memorySuggestsSkill: false,
      hasSkillContext,
      skillChecked: false,
      skillLoaded: false,
      skillUnavailable: false,
      hasExplicitUrl,
    });
    this.#toolGuardState.current = toWebfetchGuardState(initialToolSelection);
    this.#toolResults.clear();
    const initialGovernance = this.#toolGovernance.current.snapshot();
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
      webfetchAllowed: initialToolSelection.webfetchAllowed,
      webfetchGuardReason: initialToolSelection.webfetchGuardReason,
      toolMaxExecutions: initialGovernance.maxExecutions,
      toolMaxConsecutiveNoProgress: initialGovernance.maxConsecutiveNoProgress,
      snapshotId: input.contextSnapshot?.id ?? "",
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
      let streamFailed = false;
      const allToolCalls: { toolName: string; ok: boolean }[] = [];

      try {
        const difficulty = this.#session?.pendingPrediction?.difficulty ?? "medium";
        const STREAM_TIMEOUT_MS = resolveTimeout(difficulty);
        const abortController = new AbortController();
        let reportedToolSelection = "";
        let reportedGovernanceStop = "";
        let skillRevision = this.#skillService?.getRevision?.(this.#session?.sessionId) ?? 0;
        let latestPreparedStep = -1;
        const completeStep = (stepNumber: number) => {
          if (stepNumber < 0) return;
          this.bus.emit(BusEvents.Context.StepCompleted as any, {
            sessionId: this.#session?.sessionId ?? input.task?.sessionId ?? "default",
            taskId: input.task?.id ?? "task",
            stepId: String(stepNumber),
          } as any);
        };

        const streamResult = streamText({
        model,
        instructions: systemText || undefined,
        messages: userMessages as any,
        tools: tools.length > 0 ? this.#aiTools : undefined,
        stopWhen: isStepCount(this.#maxSteps),
        maxOutputTokens: this.#maxTokens,
        providerOptions: this.#providerOptions,
        abortSignal: input.abortSignal
          ? AbortSignal.any([abortController.signal, input.abortSignal])
          : abortController.signal,
        prepareStep: ({ stepNumber, steps, messages }) => {
          if (latestPreparedStep !== stepNumber) completeStep(latestPreparedStep);
          latestPreparedStep = stepNumber;
          const memorySearch = summarizeMemorySearch({ automaticQuery, automaticStatus, steps });
          const memoryRead = summarizeMemoryRead(steps);
          const skillDiscovery = summarizeSkillDiscovery(steps);
          const selection = selectActiveToolsForStep({
            availableToolNames: tools,
            memorySearchAttemptCount: memorySearch.attemptCount,
            memorySearchFound: memorySearch.found,
            memorySearchUnavailable: memorySearch.unavailable,
            memoryRead: memoryRead.read,
            memoryReadUnavailable: memoryRead.unavailable,
            memorySuggestsSkill: memoryRead.suggestsSkill,
            hasSkillContext,
            skillChecked: skillDiscovery.checked,
            skillLoaded: skillDiscovery.loaded,
            skillUnavailable: skillDiscovery.unavailable,
            hasExplicitUrl,
          });
          this.#toolGuardState.current = toWebfetchGuardState(selection);
          const governance = this.#toolGovernance.current.snapshot();
          if (governance.stopReason && governance.stopReason !== reportedGovernanceStop) {
            reportedGovernanceStop = governance.stopReason;
            this.report(BusEvents.Element.Data, {
              step: "tool-governance-stop",
              stepNumber,
              ...governance,
            });
          }
          const selectionKey = `${selection.webfetchAllowed}:${selection.webfetchGuardReason}`;
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
              skillChecked: skillDiscovery.checked,
              skillLoaded: skillDiscovery.loaded,
              skillUnavailable: skillDiscovery.unavailable,
              webfetchAllowed: selection.webfetchAllowed,
              webfetchGuardReason: selection.webfetchGuardReason,
            });
          }
          const nextSkillRevision = this.#skillService?.getRevision?.(this.#session?.sessionId) ?? 0;
          let instructions: string | undefined;
          if (nextSkillRevision !== skillRevision) {
            skillRevision = nextSkillRevision;
            const skillContext = this.#skillService?.buildContext(this.#session?.sessionId) ?? "";
            const owner = {
              sessionId: this.#session?.sessionId ?? input.task?.sessionId ?? "default",
              ...(this.#session?.currentTopic ? { topicId: this.#session.currentTopic } : {}),
            };
            const scope = this.#session?.currentTopic ? "topic" as const : "session" as const;
            if (skillContext) {
              this.#contextService.put({
                scope,
                owner,
                entry: {
                  key: "topic-skills",
                  source: "skill-service",
                  channel: "instructions",
                  trust: "trusted",
                  priority: 600,
                  content: skillContext,
                },
              });
            } else {
              this.#contextService.remove(scope, owner, "topic-skills");
            }
            const stepSnapshot = this.#contextService.createSnapshot({
              ...input.contextOwner,
              stepId: String(stepNumber),
            });
            instructions = stepSnapshot.content;
            this.bus.emit(BusEvents.Context.SnapshotRelease as any, { snapshotId: stepSnapshot.id } as any);
            this.report(BusEvents.Element.Data, {
              step: "step-snapshot-created",
              stepNumber,
              snapshotId: stepSnapshot.id,
              revision: nextSkillRevision,
              skillContextLength: skillContext.length,
            });
          }
          return {
            activeTools: selection.activeTools,
            ...(this.#toolGovernance.current.shouldForceText() ? { toolChoice: "none" as const } : {}),
            messages: pruneConsumedTransientTools(messages),
            ...(instructions === undefined ? {} : { instructions }),
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
        for await (const chunk of streamResult.stream) {
          const pt = (chunk as any).type;

          if (pt === "start" || pt === "source" || pt === "raw" || pt === "object"
            || pt === "response-metadata" || pt === "message-metadata") continue;

          if (pt !== "tool-call" && pt !== "tool-result" && stepToolCalls.length > 0) {
            const success = stepToolCalls.filter(t => t.ok).length;
            const failed = stepToolCalls.length - success;
            reportTransport(BusEvents.Transport.ToolStepFinished, {
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
              reportTransport(BusEvents.Transport.Reason, { textDelta: text, offset });
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
                reportTransport(BusEvents.Transport.Delta, { textDelta: safe, offset });
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
              reportTransport(BusEvents.Transport.Delta, { textDelta: safe, offset });
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
            reportTransport(BusEvents.Transport.ToolStarted, { toolName: c.toolName, toolCallId: c.toolCallId ?? "", input: c.input });
            continue;
          }

          if (pt === "tool-result") {
            const c = chunk as any;
            if (c.toolName === "intent") continue;
            const status = takeToolExecutionStatus(this.#toolResults, c.toolName);
            const rawResult = c.output ?? c.result;
            const toolOutput = String(c.output ?? c.result ?? status?.output ?? "");
            const toolError = c.error ?? status?.error;
            const toolOk = status?.ok ?? !toolError;
            const resultPreview = rawResult === undefined ? "" : JSON.stringify(rawResult).slice(0, 300);
            this.report(BusEvents.Element.Data, { step: "tool-call-finish", toolName: c.toolName, stepCount: this.#stepCounter.count, result: resultPreview, ok: toolOk, error: toolError });
            reportTransport(BusEvents.Transport.ToolFinished, { toolName: c.toolName, toolCallId: c.toolCallId ?? "", result: rawResult, error: toolError });
            stepToolCalls.push({ toolName: c.toolName, ok: toolOk });
            allToolCalls.push({ toolName: c.toolName, ok: toolOk });
            if (toolOk && status?.contextInjection) {
              const scope = injectToolContext({
                contextService: this.#contextService,
                injection: status.contextInjection,
                sessionId: this.#session?.sessionId ?? input.task?.sessionId ?? "default",
                topicId: this.#session?.currentTopic || undefined,
                contextOwner: input.contextOwner,
                stepId: String(this.#stepCounter.count),
              });
              this.report(BusEvents.Element.Data, {
                step: "tool-context-injected",
                toolName: c.toolName,
                scope,
                key: status.contextInjection.entry.key,
              });
            }
            if (shouldPersistToolResult(c.toolName) && this.#session?.addToolResult) {
              this.#session.addToolResult({
                toolName: c.toolName,
                topic: this.#session.currentTopic ?? "",
                timestamp: Date.now(),
                ok: toolOk,
                output: toolOutput,
                error: toolError,
              });
              this.#appendToolHistory({
                toolName: c.toolName,
                ok: toolOk,
                output: toolOutput,
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
            streamFailed = true;
            if (err.statusCode) streamErrorCode = err.statusCode;
            this.report(BusEvents.Element.Data, { step: "stream-llm-error", errorName: err.name, statusCode: err.statusCode, message: (err.message ?? "").slice(0, 500), responseBody: (err.responseBody ?? "").slice(0, 500) });
            continue;
          }

          if (pt === "abort") {
            streamFailed = true;
            this.report(BusEvents.Element.Data, { step: "abort", level: "warn" });
            continue;
          }
        }
      } finally {
        clearTimeout(timeoutTimer);
        completeStep(latestPreparedStep);
      }

      if (!completeDetected && textBuffer.length > 0) {
        const offset = fullText.length;
        fullText += textBuffer;
        reportTransport(BusEvents.Transport.Delta, { textDelta: textBuffer, offset });
      }

      this.report(BusEvents.Element.Data, { step: "stream-loop-ended", timedOut, finishReason: finishReason || "natural", stepCount: this.#stepCounter.count, fullTextLen: fullText.length });

      if (allToolCalls.length > 0) {
        const uniqueNames = [...new Set(allToolCalls.map(t => t.toolName))];
        const success = allToolCalls.filter(t => t.ok).length;
        reportTransport(BusEvents.Transport.ToolGroupComplete, {
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
            contextSnapshotAccepted: false,
          };
        }
      }

      const intents: IntentRequest[] = intentData ? [toIntentRequest(intentData)] : [];

      let response: any;
      let usage: any;
      let totalUsage: any;

      try {
        response = await Promise.race([
          streamResult.response,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("streamResult.response timeout")), 30_000)
          ),
        ]);
      } catch (err: any) {
        streamFailed = true;
        this.report(BusEvents.Element.Data, { step: "response-error", level: "warn", error: err?.message ?? String(err) });
        response = { messages: [] };
        if (!finishReason) finishReason = "error";
      }

      try {
        [usage, totalUsage] = await Promise.race([
          Promise.all([streamResult.usage, streamResult.totalUsage]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("streamResult usage timeout")), 30_000)
          ),
        ]);
      } catch (err: any) {
        streamFailed = true;
        this.report(BusEvents.Element.Data, { step: "usage-error", level: "warn", error: err?.message ?? String(err) });
        usage = { totalTokens: 0 };
        totalUsage = usage;
        if (!finishReason) finishReason = "error";
      }

      const reasoningContent = reasoningText;
      const metrics = resolveTokenMetrics(usage, totalUsage);
      const tokenUsage: TokenUsage = { total: metrics.totalUsageTokens };
      if (this.#session?.setContextTokens) {
        this.#session.setContextTokens(metrics.contextTokens);
      }

      fullText = sanitizeForJSON(fullText);
      const finalGovernance = this.#toolGovernance.current.snapshot();
      this.report(BusEvents.Element.Data, {
        step: "done",
        outputLen: fullText.length,
        totalUsageTokens: tokenUsage.total,
        contextTokens: metrics.contextTokens,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        hasIntents: intents.length > 0,
        finishReason,
        stepCount: this.#stepCounter.count,
        maxSteps: this.#maxSteps,
        toolAttempts: finalGovernance.attempts,
        toolExecutions: finalGovernance.executions,
        toolBlocked: finalGovernance.blocked,
        toolConsecutiveNoProgress: finalGovernance.consecutiveNoProgress,
        toolStopReason: finalGovernance.stopReason,
      });

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
        finishReason,
        completeDetected,
        contextSnapshotAccepted: !timedOut && !streamFailed,
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
          finishReason: "error",
          completeDetected: false,
          contextSnapshotAccepted: false,
        };
      }
      return {
        ...input,
        mode: "executing",
        responseText: sanitizeForJSON(`Error: ${err?.message ?? String(err)}`),
        tokenOverflow,
        errorStatusCode: err.statusCode ?? 0,
        finishReason: "error",
        completeDetected: false,
        contextSnapshotAccepted: false,
      };
    }
  }

  #appendToolHistory(result: { toolName: string; ok: boolean; output: string }): void {
    const sessionId = this.#session?.sessionId ?? "default";
    const topicId = this.#session?.currentTopic || undefined;
    const scope = topicId ? "topic" as const : "session" as const;
    const owner = { sessionId, ...(topicId ? { topicId } : {}) };
    const current = this.#contextService.get(scope, owner, "tool-history");
    const previous = Array.isArray(current?.content)
      ? current.content.map(message => message.content).join("\n")
      : "[Tool Execution History]";
    const time = new Date().toISOString().slice(11, 19);
    const line = `- [${time}] ${result.toolName}: ${result.ok ? "ok" : "error"}${result.output ? ` — ${substringWellFormed(result.output, 0, 80)}` : ""}`;
    this.#contextService.put({
      scope,
      owner,
      entry: {
        key: "tool-history",
        source: "tool-runtime",
        channel: "messages",
        trust: "untrusted",
        priority: 500,
        consumeOnCommit: true,
        content: [{ role: "assistant", content: `${previous}\n${line}` }],
      },
    });
  }

}

type ToolExecutionStatus = {
  ok: boolean;
  output: string;
  error?: string;
  contextInjection?: ToolContextInjection;
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

function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output === undefined) return "";
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function beginGovernedToolCall(params: {
  toolName: string;
  args: unknown;
  source?: "mcp";
  report: (event: string, payload: Record<string, unknown>) => void;
  stepCounter: { count: number };
  toolResults: Map<string, ToolExecutionStatus[]>;
  governance: { current: ToolCallLedger };
}):
  | { allowed: true; stepCount: number; decision: Extract<ToolCallDecision, { allowed: true }> }
  | { allowed: false; output: string } {
  const stepCount = ++params.stepCounter.count;
  const decision = params.governance.current.begin(params.toolName, params.args);
  params.report(BusEvents.Element.Data, {
    step: "tool-governance-decision",
    toolName: params.toolName,
    stepCount,
    ...(params.source ? { source: params.source } : {}),
    decision: decision.allowed ? "execute" : "block",
    ...(!decision.allowed ? { reason: decision.reason } : {}),
    fingerprint: decision.fingerprint,
    ...params.governance.current.snapshot(),
  });
  if (decision.allowed) return { allowed: true, stepCount, decision };

  const output = formatToolGovernanceBlock(decision);
  const error = `TOOL_GOVERNANCE_BLOCKED [${decision.reason}]`;
  pushToolExecutionStatus(params.toolResults, params.toolName, { ok: false, output, error });
  return { allowed: false, output };
}

function finishGovernedToolCall(params: {
  toolName: string;
  stepCount: number;
  decision: Extract<ToolCallDecision, { allowed: true }>;
  ok: boolean;
  source?: "mcp";
  report: (event: string, payload: Record<string, unknown>) => void;
  governance: { current: ToolCallLedger };
}): void {
  const governanceState = params.governance.current.finish(params.decision, params.ok);
  params.report(BusEvents.Element.Data, {
    step: "tool-governance-result",
    toolName: params.toolName,
    stepCount: params.stepCount,
    ...(params.source ? { source: params.source } : {}),
    fingerprint: params.decision.fingerprint,
    ok: params.ok,
    progress: params.ok,
    ...governanceState,
  });
}

function buildAllAiTools(
  tools: ToolDefinition[],
  report: (event: string, payload: Record<string, unknown>) => void,
  stepCounter: { count: number },
  toolResults: Map<string, ToolExecutionStatus[]>,
  guardState: { current: ToolGuardState },
  governance: { current: ToolCallLedger },
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
            const governed = beginGovernedToolCall({
              toolName: t.name,
              args,
              report,
              stepCounter,
              toolResults,
              governance,
            });
            if (!governed.allowed) return governed.output;
            const { stepCount: sc, decision } = governed;
            const start = Date.now();
            try {
              report(BusEvents.Element.Data, { step: "tool-execute-start", toolName: t.name, stepCount: sc, args: JSON.stringify(args).slice(0, 200) });
              const r = await t.execute(args, {
                abortSignal: opts?.abortSignal,
                sessionId: session?.sessionId,
                guardState: guardState.current,
              });
              const duration = Date.now() - start;
              report(BusEvents.Element.Data, { step: "tool-execute-done", toolName: t.name, stepCount: sc, duration, ok: r.ok });
              finishGovernedToolCall({
                toolName: t.name,
                stepCount: sc,
                decision,
                ok: r.ok,
                report,
                governance,
              });
              const deferred = r.ok
                && typeof r.data === "object"
                && r.data !== null
                && (r.data as { status?: unknown }).status === "deferred";
              if (deferred || (!r.ok && r.error?.startsWith("TOOL_GUARD_BLOCKED"))) {
                report(BusEvents.Element.Data, {
                  step: "tool-guard-blocked",
                  toolName: t.name,
                  stepCount: sc,
                  reason: guardState.current[t.name]?.reason,
                  ...(deferred ? { outcome: "deferred" } : {}),
                });
              }
              const output = r.output || (r.data === undefined ? "" : JSON.stringify(r.data));
              pushToolExecutionStatus(toolResults, t.name, {
                ok: r.ok,
                output,
                error: r.error,
                contextInjection: r.contextInjection,
              });
              if (t.name === "todowrite" && r.ok && session?.setTodoState) {
                session.setTodoState((args as any).todos ?? []);
              }
              if (!r.ok) return `Error: ${r.error}`;
              return output;
            } catch (err: any) {
              const duration = Date.now() - start;
              const error = err?.message ?? String(err);
              report(BusEvents.Element.Data, { step: "tool-execute-error", toolName: t.name, stepCount: sc, duration, error });
              finishGovernedToolCall({
                toolName: t.name,
                stepCount: sc,
                decision,
                ok: false,
                report,
                governance,
              });
              pushToolExecutionStatus(toolResults, t.name, { ok: false, output: "", error });
              return `Tool execution error: ${error}`;
            }
          },
    });
  }
  return result;
}

export function wrapMCPAiTools(
  mcpTools: Record<string, any>,
  report: (event: string, payload: Record<string, unknown>) => void,
  stepCounter: { count: number },
  toolResults: Map<string, ToolExecutionStatus[]>,
  governance: { current: ToolCallLedger },
): Record<string, any> {
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
        const governed = beginGovernedToolCall({
          toolName: name,
          args,
          source: "mcp",
          report,
          stepCounter,
          toolResults,
          governance,
        });
        if (!governed.allowed) return governed.output;
        const { stepCount: sc, decision } = governed;
        const start = Date.now();
        try {
          report(BusEvents.Element.Data, { step: "tool-execute-start", toolName: name, stepCount: sc, source: "mcp", args: JSON.stringify(args).slice(0, 200) });
          const result = await origExecute(args, opts);
          const duration = Date.now() - start;
          report(BusEvents.Element.Data, { step: "tool-execute-done", toolName: name, stepCount: sc, source: "mcp", duration });
          finishGovernedToolCall({
            toolName: name,
            stepCount: sc,
            source: "mcp",
            decision,
            ok: true,
            report,
            governance,
          });
          pushToolExecutionStatus(toolResults, name, { ok: true, output: stringifyToolOutput(result) });
          return result;
        } catch (err: any) {
          const duration = Date.now() - start;
          const error = err?.message ?? String(err);
          report(BusEvents.Element.Data, { step: "tool-execute-error", toolName: name, stepCount: sc, source: "mcp", duration, error });
          finishGovernedToolCall({
            toolName: name,
            stepCount: sc,
            source: "mcp",
            decision,
            ok: false,
            report,
            governance,
          });
          pushToolExecutionStatus(toolResults, name, { ok: false, output: "", error });
          return `MCP tool error: ${error}`;
        }
      },
    };
  }
  return wrapped;
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
