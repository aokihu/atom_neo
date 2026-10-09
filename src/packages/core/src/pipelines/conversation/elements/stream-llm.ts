import { createHash } from "node:crypto";
import { BaseElement, sanitizeForJSON, substringWellFormed } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { streamText, tool, zodSchema, asSchema } from "ai";
import type { ModelMessage } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ToolContextInjection, ToolDefinition, ToolEffect, ToolResultMetadata, ToolsGroup } from "@atom-neo/shared";
import { BusEvents, IntentRequestType, IntentRequestSource } from "@atom-neo/shared";
import type { IntentRequest } from "@atom-neo/shared";
import type { TokenUsage, TodoItem } from "../../../session/context";
import { findTodoTarget, selectCurrentTodo } from "../../../session/context";
import { DEFAULT_MAX_TOKENS, DEFAULT_CONTEXT_LIMIT, CONTEXT_RESERVE } from "../../../constants";
import { IntentInputSchema, retainIntentMemory } from "../../../tools/builtin/intent";
import type { IntentToolInput } from "../../../tools/builtin/intent";
import type { ConversationFlowState, ToolEffectSummary } from "./types";
import { calcTokenUsage, calcTokenRatio } from "../../shared";
import type { SkillServiceLike } from "../../../skills/types";
import { CONTEXT_DATA_HEADER } from "../../../context/compiler";
import type { ContextService } from "../../../context/context-service";
import type { ToolRecordStore } from "../../../tools/tool-record-store";
import {
  buildToolStepInstruction,
  formatToolBatchBlock,
  projectToolMessages,
  stripToolCallMarkup,
  toSchemaOnlyTools,
  validateToolCallBatch,
} from "./tool-loop";
import type { ManualToolCall, ToolStepRecord } from "./tool-loop";
import {
  formatToolGovernanceBlock,
  ToolCallLedger,
} from "../../../tools/governance";
import type { ToolCallDecision } from "../../../tools/governance";

export function resolveModelInput(input: Pick<
  ConversationFlowState,
  "contextSnapshot" | "systemText" | "userMessages"
>) {
  return {
    systemText: input.contextSnapshot?.content ?? input.systemText ?? "",
    userMessages: (input.userMessages ?? []).map(message => message.role === "assistant" && message.reasoning_content
      ? { role: "assistant" as const, content: [
          { type: "reasoning" as const, text: message.reasoning_content },
          { type: "text" as const, text: message.content },
        ] }
      : { role: message.role, content: message.content }) as ModelMessage[],
  };
}

export function resolveCacheMetrics(usage?: {
  inputTokens?: number; outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number; noCacheTokens?: number };
}) {
  return {
    inputTokens: usage?.inputTokens ?? null,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
    noCacheTokens: usage?.inputTokenDetails?.noCacheTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  };
}

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

export function summarizeToolEffects(metadata: readonly ToolResultMetadata[]): ToolEffectSummary {
  const summary: ToolEffectSummary = {
    evidence: 0,
    referenceEvidence: 0,
    stateChanged: 0,
    none: 0,
    failed: 0,
  };
  for (const item of metadata) {
    if (!item.ok) summary.failed++;
    else if (item.effect === "evidence") summary.evidence++;
    else if (item.effect === "reference") summary.referenceEvidence++;
    else if (item.effect === "state_changed") summary.stateChanged++;
    else summary.none++;
  }
  return summary;
}

export function shouldRecordToolResult(
  definition: Pick<ToolDefinition, "recordPolicy"> | undefined,
  metadata: ToolResultMetadata,
): boolean {
  return definition?.recordPolicy !== "exclude"
    && (metadata.ok || metadata.errorSource === "tool");
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

export class StreamLLMElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #apiKey: string;
  #model: string;
  #baseUrl?: string;
  #beforeCall?: (signal?: AbortSignal) => Promise<void>;
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
  #toolGovernance: { current: ToolCallLedger };
  #skillService?: SkillServiceLike;
  #contextService: ContextService;
  #sameToolBatchNames: ReadonlySet<string>;
  #toolRecordStore?: ToolRecordStore;
  #toolDefinitions: ReadonlyMap<string, ToolDefinition>;
  #task?: { id?: string; chatId?: string };
  #memory: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    apiKey: string;
    model: string;
    baseUrl?: string;
    beforeCall?: (signal?: AbortSignal) => Promise<void>;
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
    toolRecordStore?: ToolRecordStore;
    task?: { id?: string; chatId?: string };
    memory?: any;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#apiKey = params.apiKey;
    this.#model = params.model;
    this.#baseUrl = params.baseUrl;
    this.#beforeCall = params.beforeCall;
    this.#maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.#maxSteps = params.maxSteps ?? 50;
    this.#providerOptions = params.providerOptions ?? {};
    this.#taskIntent = params.taskIntent ?? "conversation";
    this.#session = params.session;
    this.#configContextLimit = params.configContextLimit ?? DEFAULT_CONTEXT_LIMIT;
    this.#skillService = params.skillService;
    this.#contextService = params.contextService;
    this.#toolRecordStore = params.toolRecordStore;
    this.#task = params.task;
    this.#memory = params.memory;
    this.#toolDefinitions = new Map(params.tools.map(definition => [definition.name, definition]));
    this.#sameToolBatchNames = new Set(
      params.tools.filter(tool => tool.allowSameToolBatch === true).map(tool => tool.name),
    );
    this.#toolGovernance = { current: new ToolCallLedger({ maxExecutions: this.#maxSteps }) };
    this.#builtinTools = buildAllAiTools(params.tools, (event, payload) => this.report(event, payload), this.#stepCounter, this.#toolResults, this.#toolGovernance, this.#session, this.#task);
    const mcpCurrent = params.mcpToolsRef?.current ?? {};
    const wrappedMCP = wrapMCPAiTools(mcpCurrent, (event, payload) => this.report(event, payload), this.#stepCounter, this.#toolResults, this.#toolGovernance);
    this.#mcpToolsRef = params.mcpToolsRef;
    this.#aiTools = { ...this.#builtinTools, ...wrappedMCP };
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "formatted") return input;
    const todoBefore: TodoItem[] = structuredClone(this.#session?.todoState ?? []);
    const request = input.task?.payload?.find((part: any) => part.type === "continuation_request")?.data;
    const reconcile = request?.kind === "reconcile_progress";
    const trace = { sessionId: input.task.sessionId, taskId: input.task.id,
      parentTaskId: input.task.parentTaskId, rootTaskId: input.task.chainId };
    let currentTodo = request?.target ?? selectCurrentTodo(todoBefore);
    let todoHandoff = false;
    let reconciliationAttempts = 0;
    input = { ...input, todoBefore, currentTodo };
    if (!this.#apiKey) {
      this.report(BusEvents.Element.Data, { step: "no apiKey, fallback", ...trace, incomingContinuation: request, todoBefore, currentTodo });
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
    const availableTools = reconcile ? Object.fromEntries(Object.entries(this.#aiTools).filter(([name]) => name === "todowrite")) : this.#aiTools;
    const modelTools = toSchemaOnlyTools(availableTools);
    const tools = Object.keys(availableTools);
    this.#toolResults.clear();
    const initialGovernance = this.#toolGovernance.current.snapshot();
    this.report(BusEvents.Element.Data, {
      step: "starting LLM call",
      ...trace,
      incomingContinuation: request,
      toolNames: tools,
      model: this.#model,
      msgCount: userMessages.length,
      toolCount: tools.length,
      taskIntent: this.#taskIntent,
      toolMaxExecutions: initialGovernance.maxExecutions,
      toolNoProgressWarning: initialGovernance.maxConsecutiveNoProgress,
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
    let loopExitReason = "";
    let lastStepToolsEnabled = false;
    let completeDetected = false;
    let cumulativeUsage = 0;
    let lastUsage: any = { totalTokens: 0, inputTokens: 0, outputTokens: 0 };
    let modelStep = 0;
    let stepInstruction = "";
    let forceFinalText = false;
    let currentSystemText = systemText;
    let currentSnapshot = input.contextSnapshot;
    let contextDirty = false;
    let todoState = JSON.stringify(this.#session?.todoState ?? []);
    const snapshotBudget = (currentSnapshot && this.#contextService.inspectSnapshot(currentSnapshot.id)?.inputBudget)
      ?? Math.max(1, this.#configContextLimit - this.#maxTokens - CONTEXT_RESERVE);
    let reportedGovernanceStop = "";
    let skillRevision = this.#skillService?.getRevision?.(this.#session?.sessionId) ?? 0;
    let modelMessages = [...userMessages];
    const allToolCalls: { toolName: string; metadata: ToolResultMetadata }[] = [];
    let toolsGroup: ToolsGroup | undefined;
    const difficulty = this.#session?.pendingPrediction?.difficulty ?? "medium";
    const abortController = new AbortController();
    const streamSignal = input.abortSignal
      ? AbortSignal.any([abortController.signal, input.abortSignal])
      : abortController.signal;
    let remainingTimeout = resolveTimeout(difficulty);
    let timeoutStartedAt = Date.now();
    const onTimeout = () => {
      timedOut = true;
      this.report(BusEvents.Element.Data, { step: "stream-timeout", level: "warn", stepCount: this.#stepCounter.count });
      abortController.abort();
    };
    let timeoutTimer = setTimeout(onTimeout, remainingTimeout);

    const completeStep = (stepNumber: number) => {
      this.bus.emit(BusEvents.Context.StepCompleted as any, {
        sessionId: this.#session?.sessionId ?? input.task?.sessionId ?? "default",
        taskId: input.task?.id ?? "task",
        stepId: String(stepNumber),
      } as any);
    };

    const refreshStepContext = () => {
      const nextRevision = this.#skillService?.getRevision?.(this.#session?.sessionId) ?? 0;
      const nextTodos = JSON.stringify(this.#session?.todoState ?? []);
      const skillChanged = nextRevision !== skillRevision;
      const todosChanged = nextTodos !== todoState;
      if (!skillChanged && !todosChanged && !contextDirty) return;
      const refreshReason = { skillChanged, todosChanged, contextChanged: contextDirty };
      todoState = nextTodos;
      contextDirty = false;
      skillRevision = nextRevision;
      const skillContext = skillChanged ? this.#skillService?.buildContext(this.#session?.sessionId) ?? "" : "";
      const owner = {
        sessionId: this.#session?.sessionId ?? input.task?.sessionId ?? "default",
        ...(this.#session?.currentTopic ? { topicId: this.#session.currentTopic } : {}),
      };
      const scope = this.#session?.currentTopic ? "topic" as const : "session" as const;
      if (skillChanged && skillContext) {
        this.#contextService.put({
          scope,
          owner,
          entry: {
            key: "topic-skills",
            format: "text",
            source: "skill-service",
            channel: "instructions",
            trust: "trusted",
            priority: 600,
            content: skillContext,
          },
        });
      } else if (skillChanged) {
        this.#contextService.remove(scope, owner, "topic-skills");
      }
      if (todosChanged) {
        const taskOwner = { ...owner, taskId: input.task?.id ?? "task" };
        const state = this.#contextService.get("task", taskOwner, "task-state");
        if (state) {
          const { revision: _revision, ...entry } = state;
          this.#contextService.put({ scope: "task", owner: taskOwner,
          entry: { ...entry, content: { ...(state.content as Record<string, unknown>),
            todos: this.#session?.todoState ?? [] } } });
        }
      }
      const stepSnapshot = this.#contextService.createSnapshot({
        ...input.contextOwner,
        stepId: String(modelStep),
        inputBudget: snapshotBudget,
      });
      currentSystemText = stepSnapshot.content;
      if (currentSnapshot) this.#contextService.releaseSnapshot(currentSnapshot.id);
      currentSnapshot = stepSnapshot;
      this.report(BusEvents.Element.Data, {
        step: "step-snapshot-created",
        stepNumber: modelStep,
        snapshotId: stepSnapshot.id,
        revision: nextRevision,
        skillContextLength: skillContext.length,
        refreshReason,
        inputBudget: snapshotBudget,
      });
    };

    try {
      const schemaDescriptions = await Promise.all(Object.entries(modelTools).map(async ([name, definition]) => ({
        name, description: definition.description, inputSchema: await asSchema(definition.inputSchema).jsonSchema,
      })));
      const toolDefinitionsHash = createHash("sha256").update(JSON.stringify(schemaDescriptions)).digest("hex").slice(0, 16);
      while (!timedOut && modelStep <= this.#maxSteps + 1 && (!reconcile || reconciliationAttempts < 2)) {
        refreshStepContext();
        const governance = this.#toolGovernance.current.snapshot();
        if (governance.stopReason && governance.stopReason !== reportedGovernanceStop) {
          reportedGovernanceStop = governance.stopReason;
          this.report(BusEvents.Element.Data, { step: "tool-governance-stop", stepNumber: modelStep, ...governance });
        }
        const forceText = forceFinalText || this.#toolGovernance.current.shouldForceText();
        lastStepToolsEnabled = !forceText && tools.length > 0;
        const instructions = [currentSystemText, stepInstruction].filter(Boolean).join("\n\n");
        if (this.#beforeCall) {
          clearTimeout(timeoutTimer);
          remainingTimeout = Math.max(0, remainingTimeout - (Date.now() - timeoutStartedAt));
          try { await this.#beforeCall(streamSignal); }
          finally { timeoutStartedAt = Date.now(); timeoutTimer = setTimeout(onTimeout, remainingTimeout); }
          streamSignal.throwIfAborted();
        }
        const streamResult = streamText({
          model,
          instructions: instructions || undefined,
          messages: modelMessages,
          tools: !forceText && tools.length > 0 ? modelTools : undefined,
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
            finishReason = "error";
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
            finishReason = "error";
            streamFailed = true;
            this.report(BusEvents.Element.Data, { step: "abort", level: "warn" });
          }
        }

        let usageTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          lastUsage = await Promise.race([
            streamResult.usage,
            new Promise<never>((_, reject) =>
              usageTimer = setTimeout(() => reject(new Error("streamResult usage timeout")), 30_000)
            ),
          ]);
          cumulativeUsage += lastUsage?.totalTokens ?? 0;
          const staticText = currentSystemText.split(CONTEXT_DATA_HEADER)[0] ?? "";
          this.report(BusEvents.Element.Data, {
            step: "model-step-usage", stepNumber: modelStep, model: this.#model,
            snapshotId: currentSnapshot?.id ?? "",
            ...resolveCacheMetrics(lastUsage),
            toolDefinitionsHash: forceText ? null : toolDefinitionsHash,
            staticPrefixHash: createHash("sha256").update(staticText).digest("hex").slice(0, 16),
            staticChars: staticText.length, dynamicChars: currentSystemText.length - staticText.length,
          });
          if (currentSnapshot && !streamFailed && !timedOut && !streamSignal.aborted) {
            if (this.#contextService.commitSnapshot(currentSnapshot.id) > 0) contextDirty = true;
          }
        } catch (err: any) {
          streamFailed = true;
          finishReason = "error";
          this.report(BusEvents.Element.Data, { step: "usage-error", level: "warn", error: err?.message ?? String(err) });
        } finally {
          clearTimeout(usageTimer);
        }

        this.report(BusEvents.Element.Data, {
          step: "model-step-ended",
          ...trace,
          snapshotId: currentSnapshot?.id,
          toolsEnabled: lastStepToolsEnabled,
          todowriteAvailable: lastStepToolsEnabled && tools.includes("todowrite"),
          forceText,
          currentTodo,
          currentTodoState: findTodoTarget(this.#session?.todoState ?? [], currentTodo),
          stepNumber: modelStep,
          finishReason: finishReason || "natural",
          toolCallCount: stepCalls.length,
          textLength: stepText.length,
        });

        reasoningText += stepReasoning;
        if (stepCalls.length === 0) {
          const markerIndex = stepText.indexOf("<<<COMPLETE>>>");
          if (markerIndex >= 0) {
            stepText = stepText.slice(0, markerIndex);
            completeDetected = true;
            this.report(BusEvents.Element.Data, { step: "complete-marker-detected" });
          }
        }
        const visibleStepText = reconcile ? "" : stripToolCallMarkup(stepText);
        if (visibleStepText) {
          const offset = fullText.length;
          const textDelta = (fullText ? "\n\n" : "") + visibleStepText;
          fullText += textDelta;
          reportTransport(BusEvents.Transport.Delta, { textDelta, offset });
        }

        if (stepCalls.length === 0) {
          loopExitReason = "no_tool_calls";
          completeStep(modelStep);
          break;
        }

        if (forceText) {
          loopExitReason = "tools_forced_off";
          this.report(BusEvents.Element.Data, {
            step: "tool-call-ignored",
            stepNumber: modelStep,
            reason: "framework_force_text",
            toolNames: stepCalls.map(call => call.toolName),
          });
          completeStep(modelStep);
          break;
        }

        if (reconcile) reconciliationAttempts += stepCalls.length;
        const batchDecision = validateToolCallBatch(stepCalls, this.#sameToolBatchNames);
        if (!batchDecision.allowed) {
          const error = formatToolBatchBlock(batchDecision);
          const metadata = { ok: false, effect: "none", error, errorSource: "guard" } as const;
          const stepRecords = new Map<string, ToolStepRecord>();
          const governanceState = this.#toolGovernance.current.rejectBatch(stepCalls.length);
          this.report(BusEvents.Element.Data, {
            step: "tool-batch-blocked",
            stepNumber: modelStep,
            reason: batchDecision.reason,
            toolNames: batchDecision.toolNames,
            callCount: stepCalls.length,
            ...governanceState,
          });
          for (const call of stepCalls) {
            stepRecords.set(call.toolCallId, {
              toolName: call.toolName,
              input: call.input,
              content: "",
              metadata,
            });
            allToolCalls.push({ toolName: call.toolName, metadata });
            reportTransport(BusEvents.Transport.ToolStarted, {
              toolName: call.toolName,
              toolCallId: call.toolCallId,
              input: call.input,
            });
            reportTransport(BusEvents.Transport.ToolFinished, {
              toolName: call.toolName,
              toolCallId: call.toolCallId,
              error,
            });
          }
          modelMessages = [...modelMessages, ...projectToolMessages(stepCalls, stepRecords, visibleStepText, stepReasoning)];
          stepInstruction = error;
          reportTransport(BusEvents.Transport.ToolStepFinished, {
            stepNumber: modelStep,
            total: stepCalls.length,
            success: 0,
            failed: stepCalls.length,
            toolNames: stepCalls.map(call => call.toolName),
          });
          completeStep(modelStep);
          modelStep++;
          continue;
        }

        const stepRecords = new Map<string, ToolStepRecord>();
        let completedCalls = 0;
        let failedCalls = 0;
        let intentRequested = false;

        for (const [batchIndex, call] of stepCalls.entries()) {
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

          if (call.toolName === "intent" && !reconcile) {
            const parsed = IntentInputSchema.safeParse(call.input);
            const metadata: ToolResultMetadata = parsed.success
              ? { ok: true, effect: "none" } as const
              : { ok: false, effect: "none", error: "Invalid intent input", errorSource: "tool" } as const;
            stepRecords.set(call.toolCallId, { toolName: call.toolName, input: call.input,
              content: parsed.success ? "Intent received" : "Invalid intent input", metadata });
            allToolCalls.push({ toolName: call.toolName, metadata });
            if (parsed.success) {
              if (parsed.data.action === "follow_up") {
                intentData = parsed.data;
                intentRequested = true;
              } else {
                if (retainIntentMemory(this.#memory, parsed.data.mem_id ?? "") && metadata.ok) metadata.effect = "state_changed";
              }
              completedCalls++;
            } else failedCalls++;
            reportTransport(BusEvents.Transport.ToolFinished, {
              toolName: call.toolName, toolCallId: call.toolCallId,
              result: parsed.success ? "Intent received" : undefined,
              error: parsed.success ? undefined : "Invalid intent input",
            });
            continue;
          }

          const executor = availableTools[call.toolName]?.execute;
          let status: ToolExecutionStatus;
          if (typeof executor !== "function") {
            status = {
              content: "",
              metadata: {
                ok: false,
                effect: "none",
                error: `No executor registered for ${call.toolName}`,
                errorSource: "runtime",
              },
            };
          } else {
            try {
              await executor(call.input, { abortSignal: streamSignal });
              status = takeToolExecutionStatus(this.#toolResults, call.toolName) ?? {
                content: "",
                metadata: {
                  ok: false,
                  effect: "none",
                  error: `Executor did not report metadata for ${call.toolName}`,
                  errorSource: "runtime",
                },
              };
            } catch (err: any) {
              status = {
                content: "",
                metadata: {
                  ok: false,
                  effect: "none",
                  error: err?.message ?? String(err),
                  errorSource: "runtime",
                },
              };
            }
          }

          const record: ToolStepRecord = {
            toolName: call.toolName,
            input: call.input,
            content: status.content,
            metadata: status.metadata,
          };
          stepRecords.set(call.toolCallId, record);
          allToolCalls.push({ toolName: call.toolName, metadata: status.metadata });
          if (status.metadata.ok) completedCalls++;
          else failedCalls++;
          if (call.toolName === "todowrite" && status.metadata.ok) {
            const todos: TodoItem[] = this.#session?.todoState ?? [];
            if (!currentTodo && !reconcile) currentTodo = selectCurrentTodo(todos);
            const current = findTodoTarget(todos, currentTodo);
            if (current && (current.todo.status === "completed" || current.todo.status === "cancelled")) todoHandoff = true;
            if (reconcile) todoHandoff = true;
          }
          const error = status.metadata.ok ? undefined : status.metadata.error;
          this.report(BusEvents.Element.Data, {
            step: "tool-call-finish",
            toolName: call.toolName,
            stepNumber: modelStep,
            result: status.content.slice(0, 300),
            ok: status.metadata.ok,
            effect: status.metadata.effect,
            error,
          });
          reportTransport(BusEvents.Transport.ToolFinished, {
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            result: status.content,
            error,
          });
          const contextInjection = status.metadata.ok ? status.metadata.contextInjection : undefined;
          if (contextInjection) {
            contextDirty = true;
            const scope = injectToolContext({
              contextService: this.#contextService,
              injection: contextInjection,
              sessionId: this.#session?.sessionId ?? input.task?.sessionId ?? "default",
              topicId: this.#session?.currentTopic || undefined,
              contextOwner: input.contextOwner,
              stepId: String(modelStep + 1),
            });
            this.report(BusEvents.Element.Data, {
              step: "tool-context-injected",
              toolName: call.toolName,
              scope,
              key: contextInjection.entry.key,
            });
          }
          const definition = this.#toolDefinitions.get(call.toolName);
          const recordable = shouldRecordToolResult(definition, status.metadata);
          let toolRecord: ReturnType<ToolRecordStore["append"]> | undefined;
          if (recordable && this.#toolRecordStore) {
            toolsGroup ??= this.#toolRecordStore.beginGroup(
              this.#session?.sessionId ?? input.task?.sessionId ?? "default",
              input.task?.id ?? "task",
              this.#session?.currentTopic ?? "",
            );
            toolRecord = this.#toolRecordStore.append(toolsGroup, {
              modelStep,
              batchIndex,
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              source: definition?.source ?? "mcp",
              startedAt: status.startedAt ?? Date.now(),
              durationMs: status.durationMs ?? 0,
              input: call.input,
              output: status.rawOutput ?? status.content,
              metadata: status.metadata,
            });
            this.report(BusEvents.Element.Data, {
              step: "tool-record-added",
              toolsGroupId: toolsGroup.id,
              recordId: toolRecord.id,
              recordStep: toolRecord.step,
              modelStep,
              batchIndex,
              toolName: call.toolName,
            });
          }
          if (recordable) {
            this.#session?.addToolResult?.({
              toolName: call.toolName,
              topic: this.#session.currentTopic ?? "",
              timestamp: toolRecord?.startedAt ?? status.startedAt ?? Date.now(),
              content: status.content,
              metadata: status.metadata,
              durationMs: toolRecord?.durationMs ?? status.durationMs ?? 0,
            });
          }
        }

        const projectedMessages = projectToolMessages(stepCalls, stepRecords, visibleStepText, stepReasoning);
        if (projectedMessages.length > 0) {
          modelMessages = [...modelMessages, ...projectedMessages];
        }
        const nextGovernance = this.#toolGovernance.current.snapshot();
        stepInstruction = buildToolStepInstruction({
          consecutiveNoProgress: nextGovernance.consecutiveNoProgress,
          warningThreshold: nextGovernance.maxConsecutiveNoProgress,
          stopReason: nextGovernance.stopReason,
        });
        forceFinalText = Boolean(nextGovernance.stopReason);
        reportTransport(BusEvents.Transport.ToolStepFinished, {
          stepNumber: modelStep,
          total: stepCalls.length,
          success: completedCalls,
          failed: failedCalls,
          toolNames: stepCalls.map(call => call.toolName),
        });
        completeStep(modelStep);
        if (intentRequested || todoHandoff) {
          loopExitReason = intentRequested ? "intent_follow_up" : reconcile ? "reconciliation_updated" : "todo_handoff";
          break;
        }
        modelStep++;
      }
    } catch (err: any) {
      loopExitReason = "stream_error";
      streamFailed = true;
      finishReason = "error";
      streamErrorCode = err?.statusCode ?? 0;
      this.report(BusEvents.Element.Data, { step: "error", level: "warn", error: err?.message ?? String(err) });
    } finally {
      clearTimeout(timeoutTimer);
      if (currentSnapshot) this.#contextService.releaseSnapshot(currentSnapshot.id);
    }

    if (toolsGroup && this.#toolRecordStore) {
      this.#toolRecordStore.seal(toolsGroup, streamFailed || timedOut ? "interrupted" : "sealed");
      this.report(BusEvents.Element.Data, {
        step: "tool-record-group-sealed",
        toolsGroupId: toolsGroup.id,
        recordCount: toolsGroup.records.length,
        status: toolsGroup.status,
      });
    }

    const finalGovernance = this.#toolGovernance.current.snapshot();
    if (!fullText && finalGovernance.stopReason) {
      fullText = "未获得可用的工具证据，当前工具执行已停止。";
      reportTransport(BusEvents.Transport.Delta, { textDelta: fullText, offset: 0 });
    }
    this.report(BusEvents.Element.Data, {
      step: "stream-loop-ended",
      ...trace,
      snapshotId: currentSnapshot?.id,
      incomingContinuation: request,
      exitReason: input.abortSignal?.aborted ? "cancelled" : timedOut ? "timeout" : loopExitReason
        || (reconcile && reconciliationAttempts >= 2 ? "reconciliation_attempt_limit" : "model_step_limit"),
      toolsEnabled: lastStepToolsEnabled,
      todowriteAvailable: lastStepToolsEnabled && tools.includes("todowrite"),
      currentTodo,
      todoBefore,
      todoAfter: structuredClone(this.#session?.todoState ?? []),
      todoHandoff,
      reconciliationAttempts,
      streamFailed,
      cancelled: !!input.abortSignal?.aborted,
      governance: finalGovernance,
      timedOut,
      finishReason: finishReason || "natural",
      stepCount: this.#stepCounter.count,
      modelStepCount: modelStep + 1,
      fullTextLen: fullText.length,
    });

    if (allToolCalls.length > 0) {
      const uniqueNames = [...new Set(allToolCalls.map(call => call.toolName))];
      const success = allToolCalls.filter(call => call.metadata.ok).length;
      reportTransport(BusEvents.Transport.ToolGroupComplete, {
        total: allToolCalls.length,
        success,
        failed: allToolCalls.length - success,
        toolNames: uniqueNames,
      });
    }

    tokenOverflow = finishReason !== "length" && !reconcile && !timedOut && this.#stepCounter.count === 0 && fullText.length === 0 && !streamFailed;
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
      toolStopReason: finalGovernance.stopReason ?? (modelStep > this.#maxSteps + 1 ? "model_step_limit" : undefined),
    });

    return {
      ...input,
      mode: "executing",
      responseText: fullText || (!reconcile && streamFailed ? "工具循环执行失败。" : ""),
      reasoningContent: reasoningText,
      tokenUsage,
      intents,
      todoBefore,
      currentTodo,
      todoHandoff,
      toolStopReason: finalGovernance.stopReason ?? (modelStep > this.#maxSteps + 1 ? "model_step_limit" : undefined),
      streamInterrupted: timedOut || streamFailed,
      cancelled: input.abortSignal?.aborted ?? false,
      tokenOverflow,
      errorStatusCode: streamErrorCode,
      finishReason,
      completeDetected,
      toolEffectSummary: summarizeToolEffects(allToolCalls.map(call => call.metadata)),
      contextSnapshotAccepted: !timedOut && !streamFailed,
    };
  }

}

type ToolExecutionStatus = {
  content: string;
  rawOutput?: unknown;
  metadata: ToolResultMetadata;
  startedAt?: number;
  durationMs?: number;
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

function hasStructuredValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function resolveMCPToolMetadata(result: unknown): ToolResultMetadata {
  if (!result || typeof result !== "object") {
    return { ok: true, effect: hasStructuredValue(result) ? "reference" : "none" };
  }
  const record = result as Record<string, unknown>;
  if (record.isError === true) {
    return { ok: false, effect: "none", error: "MCP tool returned isError", errorSource: "tool" };
  }
  if (Array.isArray(record.content)) {
    const contentEvidence = record.content.some(part => {
      if (!part || typeof part !== "object") return hasStructuredValue(part);
      const content = part as Record<string, unknown>;
      return content.type === "text"
        ? typeof content.text === "string" && content.text.trim().length > 0
        : true;
    });
    return {
      ok: true,
      effect: contentEvidence || hasStructuredValue(record.structuredContent) ? "reference" : "none",
    };
  }
  if ("toolResult" in record && !hasStructuredValue(record.toolResult)) {
    return { ok: true, effect: "none" };
  }
  return { ok: true, effect: "reference" };
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
    content: output,
    metadata: { ok: false, effect: "none", error, errorSource: "guard" },
  });
  return { allowed: false, output };
}

function finishGovernedToolCall(params: {
  toolName: string;
  stepCount: number;
  decision: Extract<ToolCallDecision, { allowed: true }>;
  metadata: ToolResultMetadata;
  source?: "mcp";
  report: (event: string, payload: Record<string, unknown>) => void;
  governance: { current: ToolCallLedger };
}): void {
  const governanceState = params.governance.current.finish(params.decision, params.metadata.effect);
  params.report(BusEvents.Element.Data, {
    step: "tool-governance-result",
    toolName: params.toolName,
    stepCount: params.stepCount,
    ...(params.source ? { source: params.source } : {}),
    fingerprint: params.decision.fingerprint,
    ok: params.metadata.ok,
    effect: params.metadata.effect,
    ...governanceState,
  });
}

function buildAllAiTools(
  tools: ToolDefinition[],
  report: (event: string, payload: Record<string, unknown>) => void,
  stepCounter: { count: number },
  toolResults: Map<string, ToolExecutionStatus[]>,
  governance: { current: ToolCallLedger },
  session?: any,
  task?: { id?: string; chatId?: string },
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
                taskId: task?.id,
                chatId: task?.chatId,
                evidenceQuery: [...(session?.messages ?? [])].reverse().find((message: any) => message.role === "user")?.content
                  || "",
              });
              const duration = Date.now() - start;
              const content = stringifyToolOutput(r.content);
              report(BusEvents.Element.Data, {
                step: "tool-execute-done",
                toolName: t.name,
                stepCount: sc,
                duration,
                ok: r.metadata.ok,
                effect: r.metadata.effect,
              });
              finishGovernedToolCall({
                toolName: t.name,
                stepCount: sc,
                decision,
                metadata: r.metadata,
                report,
                governance,
              });
              pushToolExecutionStatus(toolResults, t.name, {
                content,
                rawOutput: r.content,
                metadata: r.metadata,
                startedAt: start,
                durationMs: duration,
              });
              if (t.name === "todowrite" && r.metadata.ok && session?.setTodoState) {
                session.setTodoState((args as any).todos ?? []);
              }
              return r.metadata.ok ? content : "Tool execution failed";
            } catch (err: any) {
              const duration = Date.now() - start;
              const error = err?.message ?? String(err);
              report(BusEvents.Element.Data, { step: "tool-execute-error", toolName: t.name, stepCount: sc, duration, error });
              finishGovernedToolCall({
                toolName: t.name,
                stepCount: sc,
                decision,
                metadata: { ok: false, effect: "none", error, errorSource: "tool" },
                report,
                governance,
              });
              pushToolExecutionStatus(toolResults, t.name, {
                content: "",
                metadata: { ok: false, effect: "none", error, errorSource: "tool" },
                startedAt: start,
                durationMs: duration,
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
          const metadata = resolveMCPToolMetadata(result);
          const duration = Date.now() - start;
          report(BusEvents.Element.Data, {
            step: "tool-execute-done",
            toolName: name,
            stepCount: sc,
            source: "mcp",
            duration,
            ok: metadata.ok,
            effect: metadata.effect,
          });
          finishGovernedToolCall({
            toolName: name,
            stepCount: sc,
            source: "mcp",
            decision,
            metadata,
            report,
            governance,
          });
          pushToolExecutionStatus(toolResults, name, {
            content: stringifyToolOutput(result),
            rawOutput: result,
            metadata,
            startedAt: start,
            durationMs: duration,
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
            metadata: { ok: false, effect: "none", error, errorSource: "tool" },
            report,
            governance,
          });
          pushToolExecutionStatus(toolResults, name, {
            content: "",
            metadata: { ok: false, effect: "none", error, errorSource: "tool" },
            startedAt: start,
            durationMs: duration,
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
