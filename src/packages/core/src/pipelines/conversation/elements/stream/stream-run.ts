import { BusEvents } from "@atom-neo/shared";
import { getTaskPayload } from "@core/session/element-session";
import { selectCurrentTodo } from "@core/session/context";
import { ToolCallLedger } from "@core/tools/governance";
import { CONTEXT_RESERVE } from "@core/constants";
import { createLanguageModel } from "@core/pipelines/shared/model-provider";
import { toSchemaOnlyTools } from "../tool-loop";
import type { ConversationFlowState } from "../types";
import { createStreamTrace, createTransportReporter } from "./stream-reporting";
import { resolveModelInput } from "./stream-model-input";
import { StepContextController } from "./stream-context";
import { StreamDeadline, resolveTimeout } from "./stream-step";
import { runStreamLoop } from "./stream-loop";
import { finalizeStream } from "./stream-finalize";
import { wrapMCPAiTools } from "./tool-runtime-mcp";
import type { DomainEmitter, StreamConfig, StreamReporter, StreamRun, StreamTrace } from "./types";

/** Runs one complete conversation stream: run setup, manual loop, final projection. */
export async function runConversationStream(deps: {
  config: StreamConfig;
  report: StreamReporter;
  emitDomain: DomainEmitter;
}, input: ConversationFlowState): Promise<ConversationFlowState> {
  if (input.mode !== "formatted") return input;
  const prepared = prepareStreamRun(deps, input);
  if ("early" in prepared) return prepared.early;
  await runStreamLoop(prepared.run);
  return finalizeStream(prepared.run);
}

function prepareStreamRun(
  deps: { config: StreamConfig; report: StreamReporter; emitDomain: DomainEmitter },
  input: ConversationFlowState,
): { early: ConversationFlowState } | { run: StreamRun } {
  const config = deps.config;
  const initial = prepareInitialInput(input, config);
  input = initial.input;
  if (!config.apiKey) {
    deps.report(BusEvents.Element.Data, {
      step: "no apiKey, fallback",
      ...initial.trace,
      incomingContinuation: initial.request,
      todoBefore: initial.todoBefore,
      currentTodo: initial.currentTodo,
    });
    return { early: { ...input, mode: "executing", responseText: "(no API key configured)" } };
  }
  const reportTransport = createTransportReporter(deps.report, input.task);
  const { userMessages, systemText } = resolveModelInput(input);
  const tools = prepareModelTools(config, deps.report, initial.reconcile);
  const initialGovernance = config.governance.current.snapshot();
  deps.report(BusEvents.Element.Data, {
    step: "starting LLM call",
    ...initial.trace,
    incomingContinuation: initial.request,
    toolNames: tools.toolNames,
    model: config.model,
    msgCount: userMessages.length,
    toolCount: tools.toolNames.length,
    taskIntent: config.taskIntent,
    toolMaxExecutions: initialGovernance.maxExecutions,
    toolNoProgressWarning: initialGovernance.maxConsecutiveNoProgress,
    snapshotId: input.contextSnapshot?.id ?? "",
  });
  const model = createLanguageModel({
    provider: config.provider,
    protocol: config.protocol,
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
  });
  config.stepCounter.count = 0;
  const snapshotBudget = (input.contextSnapshot && config.contextService.inspectSnapshot(input.contextSnapshot.id)?.inputBudget)
    ?? Math.max(1, config.configContextLimit - config.maxTokens - CONTEXT_RESERVE);
  return {
    run: createStreamRun({
      deps, config, input, reportTransport, userMessages, systemText, snapshotBudget, model,
      request: initial.request,
      reconcile: initial.reconcile,
      trace: initial.trace,
      todoBefore: initial.todoBefore,
      currentTodo: initial.currentTodo,
      tools,
    }),
  };
}

function prepareInitialInput(input: ConversationFlowState, config: StreamConfig) {
  const todoBefore = structuredClone([...(config.session?.todoState ?? [])]);
  const request = getTaskPayload(input.task, "continuation_request");
  const reconcile = request?.kind === "reconcile_progress";
  const trace = createStreamTrace(input.task);
  const currentTodo = request?.target ?? selectCurrentTodo(todoBefore);
  return {
    input: { ...input, todoBefore, currentTodo },
    request,
    reconcile,
    trace,
    todoBefore,
    currentTodo,
  };
}

function prepareModelTools(config: StreamConfig, report: StreamReporter, reconcile: boolean): {
  availableTools: Record<string, any>;
  modelTools: Record<string, any>;
  toolNames: string[];
} {
  config.governance.current = new ToolCallLedger({ maxExecutions: config.maxSteps });
  const wrappedMCP = wrapMCPAiTools(
    config.mcpToolsRef?.current ?? {},
    report,
    config.stepCounter,
    config.statuses,
    config.governance,
  );
  const aiTools = { ...config.builtinTools, ...wrappedMCP };
  const availableTools = reconcile
    ? Object.fromEntries(Object.entries(aiTools).filter(([name]) => name === "todowrite"))
    : aiTools;
  const modelTools = toSchemaOnlyTools(availableTools);
  const toolNames = Object.keys(availableTools);
  config.statuses.clear();
  return { availableTools, modelTools, toolNames };
}

function createStreamRun(params: {
  deps: { report: StreamReporter; emitDomain: DomainEmitter };
  config: StreamConfig;
  input: ConversationFlowState;
  reportTransport: StreamReporter;
  userMessages: StreamRun["userMessages"];
  systemText: string;
  snapshotBudget: number;
  model: ReturnType<typeof createLanguageModel>;
  request: StreamRun["request"];
  reconcile: boolean;
  trace: StreamTrace;
  todoBefore: StreamRun["todoBefore"];
  currentTodo: StreamRun["currentTodo"];
  tools: { availableTools: Record<string, any>; modelTools: Record<string, any>; toolNames: string[] };
}): StreamRun {
  const { config, deps } = params;
  const context = new StepContextController({
    contextService: config.contextService,
    session: config.session,
    task: params.input.task,
    contextOwner: params.input.contextOwner,
    contextSnapshot: params.input.contextSnapshot,
    snapshotBudget: params.snapshotBudget,
    skillService: config.skillService,
    systemText: params.systemText,
    report: deps.report,
    emitDomain: deps.emitDomain,
  });
  const difficulty = config.session?.pendingPrediction?.difficulty ?? "medium";
  const abortController = new AbortController();
  const signal = params.input.abortSignal
    ? AbortSignal.any([abortController.signal, params.input.abortSignal])
    : abortController.signal;
  let run: StreamRun;
  const deadline = new StreamDeadline(resolveTimeout(difficulty), () => {
    run.timedOut = true;
    deps.report(BusEvents.Element.Data, {
      step: "stream-timeout",
      level: "warn",
      stepCount: config.stepCounter.count,
    });
    abortController.abort();
  });
  run = {
    config,
    report: deps.report,
    reportTransport: params.reportTransport,
    input: params.input,
    task: params.input.task,
    request: params.request,
    reconcile: params.reconcile,
    trace: params.trace,
    todoBefore: params.todoBefore,
    currentTodo: params.currentTodo,
    todoHandoff: false,
    reconciliationAttempts: 0,
    userMessages: params.userMessages,
    model: params.model,
    availableTools: params.tools.availableTools,
    modelTools: params.tools.modelTools,
    toolNames: params.tools.toolNames,
    modelMessages: [...params.userMessages],
    allToolCalls: [],
    toolsGroup: undefined,
    intentData: null,
    fullText: "",
    reasoningText: "",
    transportReasoningLength: 0,
    finishReason: "",
    streamFailed: false,
    streamErrorCode: 0,
    timedOut: false,
    loopExitReason: "",
    lastStepToolsEnabled: false,
    completeDetected: false,
    cumulativeUsage: 0,
    lastUsage: { totalTokens: 0, inputTokens: 0, outputTokens: 0 },
    modelStep: 0,
    stepInstruction: "",
    forceFinalText: false,
    toolDefinitionsHash: "",
    context,
    deadline,
    signal,
  };
  return run;
}
