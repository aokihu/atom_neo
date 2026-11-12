import { BusEvents } from "@atom-neo/shared";
import type { ContinuationDecision, TodoItem, TodoTarget } from "@atom-neo/shared";
import type { ToolGovernanceSnapshot } from "../../../../tools/governance";
import type { StreamReporter, StreamTrace } from "./types";

export function reportStreamLoopEnded(params: {
  report: StreamReporter;
  trace: StreamTrace;
  snapshotId?: string;
  incomingContinuation?: ContinuationDecision;
  exitReason: string;
  toolsEnabled: boolean;
  todowriteAvailable: boolean;
  currentTodo?: TodoTarget;
  todoBefore: TodoItem[];
  todoAfter: TodoItem[];
  todoHandoff: boolean;
  reconciliationAttempts: number;
  streamFailed: boolean;
  cancelled: boolean;
  governance: ToolGovernanceSnapshot;
  timedOut: boolean;
  finishReason: string;
  stepCount: number;
  modelStepCount: number;
  fullTextLen: number;
}): void {
  params.report(BusEvents.Element.Data, {
    step: "stream-loop-ended",
    ...params.trace,
    snapshotId: params.snapshotId,
    incomingContinuation: params.incomingContinuation,
    exitReason: params.exitReason,
    toolsEnabled: params.toolsEnabled,
    todowriteAvailable: params.todowriteAvailable,
    currentTodo: params.currentTodo,
    todoBefore: params.todoBefore,
    todoAfter: params.todoAfter,
    todoHandoff: params.todoHandoff,
    reconciliationAttempts: params.reconciliationAttempts,
    streamFailed: params.streamFailed,
    cancelled: params.cancelled,
    governance: params.governance,
    timedOut: params.timedOut,
    finishReason: params.finishReason,
    stepCount: params.stepCount,
    modelStepCount: params.modelStepCount,
    fullTextLen: params.fullTextLen,
  });
}

export function reportDone(params: {
  report: StreamReporter;
  outputLength: number;
  totalUsageTokens: number;
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  hasIntents: boolean;
  finishReason: string;
  stepCount: number;
  modelStepCount: number;
  maxSteps: number;
  governance: ToolGovernanceSnapshot;
  stopReason?: string;
}): void {
  params.report(BusEvents.Element.Data, {
    step: "done",
    outputLen: params.outputLength,
    totalUsageTokens: params.totalUsageTokens,
    contextTokens: params.contextTokens,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    hasIntents: params.hasIntents,
    finishReason: params.finishReason,
    stepCount: params.stepCount,
    modelStepCount: params.modelStepCount,
    maxSteps: params.maxSteps,
    toolAttempts: params.governance.attempts,
    toolExecutions: params.governance.executions,
    toolBlocked: params.governance.blocked,
    toolConsecutiveNoProgress: params.governance.consecutiveNoProgress,
    toolStopReason: params.stopReason,
  });
}

export function reportStreamLlmError(report: StreamReporter, error: any): void {
  report(BusEvents.Element.Data, {
    step: "stream-llm-error",
    errorName: error.name,
    statusCode: error.statusCode,
    message: (error.message ?? "").slice(0, 500),
    responseBody: (error.responseBody ?? "").slice(0, 500),
  });
}

export function reportStreamAbort(report: StreamReporter): void {
  report(BusEvents.Element.Data, { step: "abort", level: "warn" });
}

export function reportUsageError(report: StreamReporter, error: any): void {
  report(BusEvents.Element.Data, {
    step: "usage-error",
    level: "warn",
    error: error?.message ?? String(error),
  });
}

export function reportToolGroupComplete(
  reportTransport: StreamReporter,
  calls: readonly { toolName: string; metadata: { ok: boolean } }[],
): void {
  if (calls.length === 0) return;
  const uniqueNames = [...new Set(calls.map(call => call.toolName))];
  const success = calls.filter(call => call.metadata.ok).length;
  reportTransport(BusEvents.Transport.ToolGroupComplete, {
    total: calls.length,
    success,
    failed: calls.length - success,
    toolNames: uniqueNames,
  });
}
