import { areMemorySearchQueriesSimilar, BaseElement, canonicalizeMemorySearchQuery, containsSkillHint, resolveToolOutcome, sanitizeForJSON, substringWellFormed } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { pruneMessages, streamText, tool, zodSchema } from "ai";
import type { ModelMessage } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ToolContextInjection, ToolDefinition, ToolGuardState, ToolOutcome, ToolProgress } from "@atom-neo/shared";
import { BusEvents, IntentRequestType, IntentRequestSource } from "@atom-neo/shared";
import type { IntentRequest } from "@atom-neo/shared";
import type { TokenUsage } from "../../../session/context";
import { DEFAULT_MAX_TOKENS, DEFAULT_CONTEXT_LIMIT } from "../../../constants";
import { IntentInputSchema } from "../../../tools/builtin/intent";
import type { IntentToolInput } from "../../../tools/builtin/intent";
import type { ConversationFlowState, MemorySearchStatus, ToolOutcomeSummary } from "./types";
import { calcTokenUsage, calcTokenRatio } from "../../shared";
import type { SkillServiceLike } from "../../../skills/types";
import type { ContextService } from "../../../context/context-service";
import {
  buildToolStepInstruction,
  projectProgressToolMessages,
  shouldDiscardUnverifiedFinal,
  stripToolCallMarkup,
  toSchemaOnlyTools,
} from "./tool-loop";
import type { ManualToolCall, ToolStepRecord } from "./tool-loop";
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

function selectDiscoveryTools(reason: WebfetchGuardReason): ReadonlySet<string> | undefined {
  switch (reason) {
    case "memory_search_required":
      return new Set(["search_memory"]);
    case "memory_review_required":
      return new Set(["read_memory", "skill_list"]);
    case "skill_search_required":
      return new Set(["skill_list"]);
    case "skill_load_required":
      return new Set(["skill_load", "skill_section"]);
    default:
      return undefined;
  }
}

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
    case "capability_discovery_complete":
      return "Capability discovery is complete. search_memory and skill_list are exhausted for this conversation. Use webfetch for external facts.";
    case "memory_found":
      return "A Memory has been fully read. Use that evidence, or call webfetch only if external facts are still required.";
    case "explicit_url":
      return "The user supplied a URL. Call webfetch for that URL when its content is needed.";
    case "skill_context":
      return "A Skill is loaded. Follow it and call webfetch only when the Skill requires external content.";
    case "memory_unavailable":
    case "memory_read_unavailable":
    case "skill_unavailable":
      return "Capability discovery is unavailable. Use webfetch when external facts are required.";
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
  toolResults?: Array<{ toolName: string; input: unknown; output: unknown; outcome?: ToolOutcome }>;
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

export function summarizeToolOutcomes(outcomes: readonly ToolOutcome[]): ToolOutcomeSummary {
  const summary: ToolOutcomeSummary = {
    evidence: 0,
    referenceEvidence: 0,
    stateChanged: 0,
    empty: 0,
    error: 0,
    blocked: 0,
    deferred: 0,
    cancelled: 0,
  };
  for (const outcome of outcomes) {
    if (outcome.progress === "evidence") {
      if (outcome.evidenceWeight === "reference") summary.referenceEvidence++;
      else summary.evidence++;
    }
    if (outcome.progress === "state_changed") summary.stateChanged++;
    if (outcome.status !== "success") summary[outcome.status]++;
  }
  return summary;
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
      if (result.outcome?.progress === "evidence" || (!result.outcome && output.includes("<MemorySummary id="))) {
        found = true;
      }
      if (result.outcome?.status === "empty") found = false;
      if (result.outcome?.status === "error" || (!result.outcome && /memory service not connected|^Error:|tool execution error/i.test(output))) {
        unavailable = true;
      }
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
  const enabledDiscoveryTools = selectDiscoveryTools(webfetchGuardReason);
  const availableTools = [...new Set(params.availableToolNames)];
  const activeTools = enabledDiscoveryTools
    ? availableTools.filter(name => name === "intent" || enabledDiscoveryTools.has(name))
    : availableTools.filter(name => {
        if (name === "search_memory" && params.memorySearchAttemptCount > 0) return false;
        if (name === "read_memory" && (params.memoryRead || !params.memorySearchFound)) return false;
        if (name === "skill_list" && params.skillChecked) return false;
        return true;
      });
  return {
    activeTools,
    webfetchAllowed,
    webfetchGuardReason,
    ...(webfetchGuardMessage ? { webfetchGuardMessage } : {}),
  };
}

export class StreamLLMElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #apiKey: string;
  #model: string;
  #baseUrl?: string;
  #builtinTools: Record<string, any>;
  #aiTools: Record<string, any>;
  #maxTokens: number;
  #maxSteps: number;
  #providerOptions: Record<string, any>;
  #taskIntent: string;
  #stepCounter = { count: 0 };
  #session: any;
  #configContextLimit: number;
  #mcpToolsRef?: { current: Record<string, any> };
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
    this.#builtinTools = buildAllAiTools(params.tools, (event, payload) => this.report(event, payload), this.#stepCounter, this.#toolResults, this.#toolGuardState, this.#toolGovernance, this.#session);
    const mcpCurrent = params.mcpToolsRef?.current ?? {};
    const wrappedMCP = wrapMCPAiTools(mcpCurrent, (event, payload) => this.report(event, payload), this.#stepCounter, this.#toolResults, this.#toolGovernance);
    this.#mcpToolsRef = params.mcpToolsRef;
    this.#aiTools = { ...this.#builtinTools, ...wrappedMCP };
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
    const wrappedMCP = wrapMCPAiTools(mcpCurrent, (event, payload) => this.report(event, payload), this.#stepCounter, this.#toolResults, this.#toolGovernance);
    this.#aiTools = { ...this.#builtinTools, ...wrappedMCP };
    const modelTools = toSchemaOnlyTools(this.#aiTools);
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
    this.#stepCounter.count = 0;
    let fullText = "";
    let reasoningText = "";
    let transportReasoningLength = 0;
    let intentData: IntentToolInput | null = null;
    let finishReason = "";
    let tokenOverflow = false;
    let streamErrorCode = 0;
    let streamFailed = false;
    let timedOut = false;
    let completeDetected = false;
    let cumulativeUsage = 0;
    let lastUsage: any = { totalTokens: 0, inputTokens: 0, outputTokens: 0 };
    let modelStep = 0;
    let stepInstruction = "";
    let forceFinalText = false;
    let frameworkStopReason = "";
    let consecutiveInactiveSteps = 0;
    let currentSystemText = systemText;
    let reportedToolSelection = "";
    let reportedGovernanceStop = "";
    let skillRevision = this.#skillService?.getRevision?.(this.#session?.sessionId) ?? 0;
    let modelMessages = [...userMessages] as ModelMessage[];
    const frameworkSteps: MemorySearchStep[] = [];
    const allToolCalls: { toolName: string; outcome: ToolOutcome }[] = [];
    const difficulty = this.#session?.pendingPrediction?.difficulty ?? "medium";
    const abortController = new AbortController();
    const streamSignal = input.abortSignal
      ? AbortSignal.any([abortController.signal, input.abortSignal])
      : abortController.signal;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      this.report(BusEvents.Element.Data, { step: "stream-timeout", level: "warn", stepCount: this.#stepCounter.count });
      abortController.abort();
    }, resolveTimeout(difficulty));

    const completeStep = (stepNumber: number) => {
      this.bus.emit(BusEvents.Context.StepCompleted as any, {
        sessionId: this.#session?.sessionId ?? input.task?.sessionId ?? "default",
        taskId: input.task?.id ?? "task",
        stepId: String(stepNumber),
      } as any);
    };

    const refreshSkillContext = () => {
      const nextRevision = this.#skillService?.getRevision?.(this.#session?.sessionId) ?? 0;
      if (nextRevision === skillRevision) return;
      skillRevision = nextRevision;
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
        stepId: String(modelStep),
      });
      currentSystemText = stepSnapshot.content;
      this.bus.emit(BusEvents.Context.SnapshotRelease as any, { snapshotId: stepSnapshot.id } as any);
      this.report(BusEvents.Element.Data, {
        step: "step-snapshot-created",
        stepNumber: modelStep,
        snapshotId: stepSnapshot.id,
        revision: nextRevision,
        skillContextLength: skillContext.length,
      });
    };

    try {
      while (!timedOut && modelStep <= this.#maxSteps + 1) {
        refreshSkillContext();
        const memorySearch = summarizeMemorySearch({ automaticQuery, automaticStatus, steps: frameworkSteps });
        const memoryRead = summarizeMemoryRead(frameworkSteps);
        const skillDiscovery = summarizeSkillDiscovery(frameworkSteps);
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
          this.report(BusEvents.Element.Data, { step: "tool-governance-stop", stepNumber: modelStep, ...governance });
        }
        const selectionKey = `${selection.webfetchAllowed}:${selection.webfetchGuardReason}:${selection.activeTools.join(",")}`;
        if (selectionKey !== reportedToolSelection) {
          reportedToolSelection = selectionKey;
          this.report(BusEvents.Element.Data, {
            step: "tool-policy",
            stepNumber: modelStep,
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
            activeTools: selection.activeTools,
            webfetchAllowed: selection.webfetchAllowed,
            webfetchGuardReason: selection.webfetchGuardReason,
          });
        }

        const forceText = forceFinalText || this.#toolGovernance.current.shouldForceText() || Boolean(frameworkStopReason);
        const instructions = [currentSystemText, stepInstruction].filter(Boolean).join("\n\n");
        const activeModelTools = Object.fromEntries(
          selection.activeTools.flatMap(name => modelTools[name] ? [[name, modelTools[name]]] : []),
        );
        const streamResult = streamText({
          model,
          instructions: instructions || undefined,
          messages: pruneConsumedTransientTools(modelMessages),
          tools: selection.activeTools.length > 0 ? activeModelTools : undefined,
          ...(forceText ? { toolChoice: "none" as const } : {}),
          maxOutputTokens: this.#maxTokens,
          providerOptions: this.#providerOptions,
          abortSignal: streamSignal,
        });
        const stepCalls: ManualToolCall[] = [];
        let stepText = "";
        let stepReasoning = "";

        for await (const chunk of streamResult.stream) {
          const part = chunk as any;
          if (part.type === "reasoning-delta" || part.type === "reasoning") {
            const text = part.textDelta ?? part.text ?? "";
            if (text) {
              const offset = transportReasoningLength;
              stepReasoning += text;
              transportReasoningLength += text.length;
              reportTransport(BusEvents.Transport.Reason, { textDelta: text, offset });
            }
          } else if (part.type === "text-delta") {
            stepText += part.text ?? "";
          } else if (part.type === "tool-call") {
            stepCalls.push({
              toolCallId: part.toolCallId ?? `manual-${modelStep}-${stepCalls.length}`,
              toolName: part.toolName,
              input: part.input ?? part.args,
            });
          } else if (part.type === "finish" || part.type === "finish-step") {
            finishReason = part.finishReason ?? finishReason;
          } else if (part.type === "error") {
            const err = part.error ?? {};
            streamFailed = true;
            if (err.statusCode) streamErrorCode = err.statusCode;
            this.report(BusEvents.Element.Data, {
              step: "stream-llm-error",
              errorName: err.name,
              statusCode: err.statusCode,
              message: (err.message ?? "").slice(0, 500),
              responseBody: (err.responseBody ?? "").slice(0, 500),
            });
          } else if (part.type === "abort") {
            streamFailed = true;
            this.report(BusEvents.Element.Data, { step: "abort", level: "warn" });
          }
        }

        try {
          lastUsage = await Promise.race([
            streamResult.usage,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("streamResult usage timeout")), 30_000)
            ),
          ]);
          cumulativeUsage += lastUsage?.totalTokens ?? 0;
        } catch (err: any) {
          streamFailed = true;
          finishReason ||= "error";
          this.report(BusEvents.Element.Data, { step: "usage-error", level: "warn", error: err?.message ?? String(err) });
        }

        this.report(BusEvents.Element.Data, {
          step: "model-step-ended",
          stepNumber: modelStep,
          finishReason: finishReason || "natural",
          toolCallCount: stepCalls.length,
          textLength: stepText.length,
        });

        if (stepCalls.length === 0) {
          reasoningText = stepReasoning;
          const markerIndex = stepText.indexOf("<<<COMPLETE>>>");
          if (markerIndex >= 0) {
            stepText = stepText.slice(0, markerIndex);
            completeDetected = true;
            this.report(BusEvents.Element.Data, { step: "complete-marker-detected" });
          }
          const finalStepText = stripToolCallMarkup(stepText);
          const stoppedWithoutProgress = shouldDiscardUnverifiedFinal(
            allToolCalls.map(call => call.outcome),
            this.#toolGovernance.current.snapshot().stopReason ?? frameworkStopReason,
          );
          if (finalStepText && stoppedWithoutProgress) {
            this.report(BusEvents.Element.Data, {
              step: "unverified-final-discarded",
              stepNumber: modelStep,
              textLength: finalStepText.length,
              reason: "governance_stopped_without_progress",
            });
          } else if (finalStepText) {
            const offset = fullText.length;
            fullText += finalStepText;
            reportTransport(BusEvents.Transport.Delta, { textDelta: finalStepText, offset });
          }
          completeStep(modelStep);
          break;
        }

        if (forceText) {
          this.report(BusEvents.Element.Data, {
            step: "tool-call-ignored",
            stepNumber: modelStep,
            reason: "framework_force_text",
            toolNames: stepCalls.map(call => call.toolName),
          });
          completeStep(modelStep);
          break;
        }

        const stepRecords = new Map<string, ToolStepRecord>();
        const policyResults: NonNullable<MemorySearchStep["toolResults"]> = [];
        let successfulCalls = 0;
        let activeCallCount = 0;
        let intentRequested = false;
        const activeToolNames = new Set(selection.activeTools);

        for (const call of stepCalls) {
          this.report(BusEvents.Element.Data, {
            step: "tool-call-start",
            toolName: call.toolName,
            stepNumber: modelStep,
            args: stringifyToolOutput(call.input).slice(0, 200),
          });
          reportTransport(BusEvents.Transport.ToolStarted, {
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            input: call.input,
          });

          if (call.toolName === "intent") {
            activeCallCount++;
            intentRequested = true;
            const parsed = IntentInputSchema.safeParse(call.input);
            if (parsed.success) {
              intentData = parsed.data;
              successfulCalls++;
            }
            reportTransport(BusEvents.Transport.ToolFinished, {
              toolName: call.toolName,
              toolCallId: call.toolCallId,
              result: parsed.success ? "Intent received" : undefined,
              error: parsed.success ? undefined : "Invalid intent input",
            });
            continue;
          }

          let status: ToolExecutionStatus;
          if (!activeToolNames.has(call.toolName)) {
            status = {
              ok: false,
              output: "",
              error: `Tool ${call.toolName} is not active in ${selection.webfetchGuardReason}`,
              outcome: { status: "blocked", progress: "none", code: "inactive_tool" },
            };
          } else {
            activeCallCount++;
            const executor = this.#aiTools[call.toolName]?.execute;
            if (typeof executor !== "function") {
              status = {
                ok: false,
                output: "",
                error: `No executor registered for ${call.toolName}`,
                outcome: { status: "error", progress: "none", code: "missing_executor" },
              };
            } else {
              try {
                await executor(call.input, { abortSignal: streamSignal });
                status = takeToolExecutionStatus(this.#toolResults, call.toolName) ?? {
                  ok: false,
                  output: "",
                  error: `Executor did not report an outcome for ${call.toolName}`,
                  outcome: { status: "error", progress: "none", code: "missing_outcome" },
                };
              } catch (err: any) {
                status = {
                  ok: false,
                  output: "",
                  error: err?.message ?? String(err),
                  outcome: { status: "error", progress: "none" },
                };
              }
            }
          }

          const record: ToolStepRecord = {
            toolName: call.toolName,
            input: call.input,
            output: status.output,
            outcome: status.outcome,
          };
          stepRecords.set(call.toolCallId, record);
          policyResults.push(record);
          allToolCalls.push({ toolName: call.toolName, outcome: status.outcome });
          if (status.outcome.progress !== "none") successfulCalls++;
          this.report(BusEvents.Element.Data, {
            step: "tool-call-finish",
            toolName: call.toolName,
            stepNumber: modelStep,
            result: status.output.slice(0, 300),
            ok: status.ok,
            outcomeStatus: status.outcome.status,
            progress: status.outcome.progress,
            error: status.error,
          });
          reportTransport(BusEvents.Transport.ToolFinished, {
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            result: status.output,
            error: status.error,
          });
          if (status.outcome.status === "success" && status.contextInjection) {
            const scope = injectToolContext({
              contextService: this.#contextService,
              injection: status.contextInjection,
              sessionId: this.#session?.sessionId ?? input.task?.sessionId ?? "default",
              topicId: this.#session?.currentTopic || undefined,
              contextOwner: input.contextOwner,
              stepId: String(modelStep),
            });
            this.report(BusEvents.Element.Data, {
              step: "tool-context-injected",
              toolName: call.toolName,
              scope,
              key: status.contextInjection.entry.key,
            });
          }
          this.#session?.addToolResult?.({
            toolName: call.toolName,
            topic: this.#session.currentTopic ?? "",
            timestamp: Date.now(),
            ok: status.ok,
            outcome: status.outcome,
            output: status.output,
            error: status.error,
          });
        }

        frameworkSteps.push({ toolResults: policyResults });
        consecutiveInactiveSteps = activeCallCount === 0 ? consecutiveInactiveSteps + 1 : 0;
        if (consecutiveInactiveSteps >= 3) {
          frameworkStopReason = "inactive_tool_calls";
          this.report(BusEvents.Element.Data, {
            step: "tool-governance-stop",
            stepNumber: modelStep,
            stopReason: frameworkStopReason,
            consecutiveInactiveSteps,
          });
        }
        const projectedMessages = projectProgressToolMessages(stepCalls, stepRecords);
        if (projectedMessages.length > 0) {
          modelMessages = pruneConsumedTransientTools([...modelMessages, ...projectedMessages]);
        }
        const nextGovernance = this.#toolGovernance.current.snapshot();
        const nextMemorySearch = summarizeMemorySearch({ automaticQuery, automaticStatus, steps: frameworkSteps });
        const nextMemoryRead = summarizeMemoryRead(frameworkSteps);
        const nextSkillDiscovery = summarizeSkillDiscovery(frameworkSteps);
        const nextSelection = selectActiveToolsForStep({
          availableToolNames: tools,
          memorySearchAttemptCount: nextMemorySearch.attemptCount,
          memorySearchFound: nextMemorySearch.found,
          memorySearchUnavailable: nextMemorySearch.unavailable,
          memoryRead: nextMemoryRead.read,
          memoryReadUnavailable: nextMemoryRead.unavailable,
          memorySuggestsSkill: nextMemoryRead.suggestsSkill,
          hasSkillContext,
          skillChecked: nextSkillDiscovery.checked,
          skillLoaded: nextSkillDiscovery.loaded,
          skillUnavailable: nextSkillDiscovery.unavailable,
          hasExplicitUrl,
        });
        stepInstruction = buildToolStepInstruction({
          noProgress: successfulCalls === 0,
          stopReason: nextGovernance.stopReason ?? frameworkStopReason,
          webfetchGuardReason: nextSelection.webfetchGuardReason,
          nextAction: nextSelection.webfetchGuardMessage,
        });
        forceFinalText = intentRequested || Boolean(nextGovernance.stopReason ?? frameworkStopReason);
        reportTransport(BusEvents.Transport.ToolStepFinished, {
          stepNumber: modelStep,
          total: stepCalls.length,
          success: successfulCalls,
          failed: stepCalls.length - successfulCalls,
          toolNames: stepCalls.map(call => call.toolName),
        });
        completeStep(modelStep);
        modelStep++;
      }
    } catch (err: any) {
      streamFailed = true;
      finishReason = "error";
      streamErrorCode = err?.statusCode ?? 0;
      this.report(BusEvents.Element.Data, { step: "error", level: "warn", error: err?.message ?? String(err) });
    } finally {
      clearTimeout(timeoutTimer);
    }

    const finalGovernance = this.#toolGovernance.current.snapshot();
    if (!fullText && (finalGovernance.stopReason || frameworkStopReason)) {
      fullText = "未获得可用的工具证据，当前工具执行已停止。";
      reportTransport(BusEvents.Transport.Delta, { textDelta: fullText, offset: 0 });
    }
    this.report(BusEvents.Element.Data, {
      step: "stream-loop-ended",
      timedOut,
      finishReason: finishReason || "natural",
      stepCount: this.#stepCounter.count,
      modelStepCount: modelStep + 1,
      fullTextLen: fullText.length,
    });

    if (allToolCalls.length > 0) {
      const uniqueNames = [...new Set(allToolCalls.map(call => call.toolName))];
      const success = allToolCalls.filter(call => call.outcome.status === "success").length;
      reportTransport(BusEvents.Transport.ToolGroupComplete, {
        total: allToolCalls.length,
        success,
        failed: allToolCalls.length - success,
        toolNames: uniqueNames,
      });
    }

    tokenOverflow = !timedOut && this.#stepCounter.count === 0 && fullText.length === 0 && !streamFailed;
    if (tokenOverflow) {
      const tu = this.#session?.contextTokens ?? 0;
      const ratio = calcTokenRatio(tu, this.#configContextLimit, this.#maxTokens);
      const effectiveLimit = this.#configContextLimit - this.#maxTokens;
      if (ratio <= 0.8) {
        tokenOverflow = false;
        this.report(BusEvents.Element.Data, { step: "stream-error-not-overflow", ratio: +ratio.toFixed(3), tu, effectiveLimit });
      } else {
        this.report(BusEvents.Element.Data, {
          step: "token-overflow-detected",
          taskIntent: this.#taskIntent,
          msgCount: userMessages.length,
          toolCount: tools.length,
          ratio: +ratio.toFixed(3),
          tu,
          effectiveLimit,
        });
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
    const contextTokens = lastUsage?.totalTokens ?? 0;
    const tokenUsage: TokenUsage = { total: cumulativeUsage || contextTokens };
    this.#session?.setContextTokens?.(contextTokens);
    fullText = sanitizeForJSON(stripToolCallMarkup(fullText));
    this.report(BusEvents.Element.Data, {
      step: "done",
      outputLen: fullText.length,
      totalUsageTokens: tokenUsage.total,
      contextTokens,
      inputTokens: lastUsage?.inputTokens ?? 0,
      outputTokens: lastUsage?.outputTokens ?? 0,
      hasIntents: intents.length > 0,
      finishReason,
      stepCount: this.#stepCounter.count,
      modelStepCount: modelStep + 1,
      maxSteps: this.#maxSteps,
      toolAttempts: finalGovernance.attempts,
      toolExecutions: finalGovernance.executions,
      toolBlocked: finalGovernance.blocked,
      toolConsecutiveNoProgress: finalGovernance.consecutiveNoProgress,
      toolStopReason: finalGovernance.stopReason,
    });

    const chainAction = completeDetected ? undefined
      : intents.some(intent => intent.request === IntentRequestType.FOLLOW_UP) ? "follow_up"
      : finishReason === "length" ? "follow_up"
      : finishReason === "error" && streamErrorCode < 400 ? "follow_up"
      : undefined;
    return {
      ...input,
      mode: "executing",
      responseText: fullText || (streamFailed ? "工具循环执行失败。" : ""),
      reasoningContent: reasoningText,
      tokenUsage,
      intents,
      chainAction,
      tokenOverflow,
      errorStatusCode: streamErrorCode,
      finishReason,
      completeDetected,
      toolOutcomeSummary: summarizeToolOutcomes(allToolCalls.map(call => call.outcome)),
      contextSnapshotAccepted: !timedOut && !streamFailed,
    };
  }

}

type ToolExecutionStatus = {
  ok: boolean;
  output: string;
  error?: string;
  outcome: ToolOutcome;
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

function isExplicitToolOutcome(value: unknown): value is ToolOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Partial<ToolOutcome>;
  return [
    "success",
    "empty",
    "error",
    "blocked",
    "deferred",
    "cancelled",
  ].includes(outcome.status ?? "") && [
    "evidence",
    "state_changed",
    "none",
  ].includes(outcome.progress ?? "");
}

function hasStructuredValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function resolveMCPToolOutcome(result: unknown): ToolOutcome {
  if (!result || typeof result !== "object") {
    return hasStructuredValue(result)
      ? { status: "success", progress: "evidence", evidenceWeight: "reference" }
      : { status: "empty", progress: "none", evidenceWeight: "reference" };
  }
  const record = result as Record<string, unknown>;
  if (isExplicitToolOutcome(record.outcome)) {
    return { ...record.outcome, evidenceWeight: "reference" };
  }
  if (record.isError === true) {
    return { status: "error", progress: "none", evidenceWeight: "reference", code: "mcp_is_error" };
  }
  if (Array.isArray(record.content)) {
    const contentEvidence = record.content.some(part => {
      if (!part || typeof part !== "object") return hasStructuredValue(part);
      const content = part as Record<string, unknown>;
      return content.type === "text"
        ? typeof content.text === "string" && content.text.trim().length > 0
        : true;
    });
    return contentEvidence || hasStructuredValue(record.structuredContent)
      ? { status: "success", progress: "evidence", evidenceWeight: "reference" }
      : { status: "empty", progress: "none", evidenceWeight: "reference" };
  }
  if ("toolResult" in record && !hasStructuredValue(record.toolResult)) {
    return { status: "empty", progress: "none", evidenceWeight: "reference" };
  }
  return { status: "success", progress: "evidence", evidenceWeight: "reference" };
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
  pushToolExecutionStatus(params.toolResults, params.toolName, {
    ok: false,
    output,
    error,
    outcome: { status: "blocked", progress: "none", code: decision.reason },
  });
  return { allowed: false, output };
}

function finishGovernedToolCall(params: {
  toolName: string;
  stepCount: number;
  decision: Extract<ToolCallDecision, { allowed: true }>;
  ok: boolean;
  progress: ToolProgress;
  source?: "mcp";
  report: (event: string, payload: Record<string, unknown>) => void;
  governance: { current: ToolCallLedger };
}): void {
  const governanceState = params.governance.current.finish(params.decision, params.progress);
  params.report(BusEvents.Element.Data, {
    step: "tool-governance-result",
    toolName: params.toolName,
    stepCount: params.stepCount,
    ...(params.source ? { source: params.source } : {}),
    fingerprint: params.decision.fingerprint,
    ok: params.ok,
    progress: params.progress,
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
              const outcome = resolveToolOutcome(r);
              const duration = Date.now() - start;
              report(BusEvents.Element.Data, {
                step: "tool-execute-done",
                toolName: t.name,
                stepCount: sc,
                duration,
                ok: r.ok,
                outcomeStatus: outcome.status,
                progress: outcome.progress,
              });
              finishGovernedToolCall({
                toolName: t.name,
                stepCount: sc,
                decision,
                ok: r.ok,
                progress: outcome.progress,
                report,
                governance,
              });
              if (outcome.status === "deferred" || outcome.status === "blocked") {
                report(BusEvents.Element.Data, {
                  step: "tool-guard-blocked",
                  toolName: t.name,
                  stepCount: sc,
                  reason: guardState.current[t.name]?.reason,
                  outcome: outcome.status,
                });
              }
              const output = r.output || (r.data === undefined ? "" : JSON.stringify(r.data));
              pushToolExecutionStatus(toolResults, t.name, {
                ok: r.ok,
                output,
                error: r.error,
                outcome,
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
                progress: "none",
                report,
                governance,
              });
              pushToolExecutionStatus(toolResults, t.name, {
                ok: false,
                output: "",
                error,
                outcome: { status: "error", progress: "none" },
              });
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
          const outcome = resolveMCPToolOutcome(result);
          const error = outcome.status === "error" ? "MCP tool returned isError" : undefined;
          const duration = Date.now() - start;
          report(BusEvents.Element.Data, {
            step: "tool-execute-done",
            toolName: name,
            stepCount: sc,
            source: "mcp",
            duration,
            outcomeStatus: outcome.status,
            progress: outcome.progress,
          });
          finishGovernedToolCall({
            toolName: name,
            stepCount: sc,
            source: "mcp",
            decision,
            ok: !error,
            progress: outcome.progress,
            report,
            governance,
          });
          pushToolExecutionStatus(toolResults, name, {
            ok: !error,
            output: stringifyToolOutput(result),
            ...(error ? { error } : {}),
            outcome,
          });
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
            progress: "none",
            report,
            governance,
          });
          pushToolExecutionStatus(toolResults, name, {
            ok: false,
            output: "",
            error,
            outcome: { status: "error", progress: "none", evidenceWeight: "reference" },
          });
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
