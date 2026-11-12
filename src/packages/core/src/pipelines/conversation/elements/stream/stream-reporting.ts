import { createHash } from "node:crypto";
import { BusEvents } from "@atom-neo/shared";
import type { TodoTarget } from "@atom-neo/shared";
import { CONTEXT_DATA_HEADER } from "@core/context/compiler";
import type { ElementTask } from "@core/session/element-session";
import { resolveCacheMetrics } from "./stream-model-input";
import type { ModelUsage, StreamReporter, StreamTrace, TodoTargetState } from "./types";

export function createStreamTrace(task: ElementTask): StreamTrace {
  return {
    sessionId: task.sessionId,
    taskId: task.id,
    parentTaskId: task.parentTaskId,
    rootTaskId: task.chainId,
  };
}

export function createTransportReporter(report: StreamReporter, task: ElementTask): StreamReporter {
  return (eventName, payload) => report(eventName, {
    sessionId: task.sessionId,
    taskId: task.id,
    ...payload,
  });
}

export function reportModelStepUsage(params: {
  report: StreamReporter;
  model: string;
  stepNumber: number;
  snapshotId?: string;
  usage: ModelUsage | undefined;
  toolDefinitionsHash: string;
  forceText: boolean;
  currentSystemText: string;
}): void {
  const staticText = params.currentSystemText.split(CONTEXT_DATA_HEADER)[0] ?? "";
  params.report(BusEvents.Element.Data, {
    step: "model-step-usage",
    stepNumber: params.stepNumber,
    model: params.model,
    snapshotId: params.snapshotId ?? "",
    ...resolveCacheMetrics(params.usage),
    toolDefinitionsHash: params.forceText ? null : params.toolDefinitionsHash,
    staticPrefixHash: createHash("sha256").update(staticText).digest("hex").slice(0, 16),
    staticChars: staticText.length,
    dynamicChars: params.currentSystemText.length - staticText.length,
  });
}

export function reportModelStepEnded(params: {
  report: StreamReporter;
  trace: StreamTrace;
  snapshotId?: string;
  toolsEnabled: boolean;
  todowriteAvailable: boolean;
  forceText: boolean;
  currentTodo?: TodoTarget;
  currentTodoState?: TodoTargetState;
  stepNumber: number;
  finishReason: string;
  toolCallCount: number;
  textLength: number;
}): void {
  params.report(BusEvents.Element.Data, {
    step: "model-step-ended",
    ...params.trace,
    snapshotId: params.snapshotId,
    toolsEnabled: params.toolsEnabled,
    todowriteAvailable: params.todowriteAvailable,
    forceText: params.forceText,
    currentTodo: params.currentTodo,
    currentTodoState: params.currentTodoState,
    stepNumber: params.stepNumber,
    finishReason: params.finishReason,
    toolCallCount: params.toolCallCount,
    textLength: params.textLength,
  });
}
