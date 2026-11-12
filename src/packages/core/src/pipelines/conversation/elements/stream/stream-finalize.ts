import { sanitizeForJSON } from "@atom-neo/shared";
import { BusEvents, IntentRequestSource, IntentRequestType } from "@atom-neo/shared";
import type { IntentRequest } from "@atom-neo/shared";
import type { IntentToolInput } from "../../../../tools/builtin/intent";
import type { TokenUsage } from "../../../../session/context";
import { stripToolCallMarkup } from "../tool-loop";
import { summarizeToolEffects } from "./stream-model-input";
import { resolveTokenOverflow } from "./stream-overflow";
import { reportDone, reportStreamLoopEnded, reportToolGroupComplete } from "./stream-reporting-events";
import type { StreamRun } from "./types";
import type { ConversationFlowState } from "../types";

/** Projects the loop result into the ConversationFlowState Task/Pipeline contract. */
export function finalizeStream(run: StreamRun): ConversationFlowState {
  if (run.toolsGroup && run.config.toolRecordStore) {
    run.config.toolRecordStore.seal(run.toolsGroup, run.streamFailed || run.timedOut ? "interrupted" : "sealed");
    run.report(BusEvents.Element.Data, {
      step: "tool-record-group-sealed",
      toolsGroupId: run.toolsGroup.id,
      recordCount: run.toolsGroup.records.length,
      status: run.toolsGroup.status,
    });
  }

  const finalGovernance = run.config.governance.current.snapshot();
  if (!run.fullText && finalGovernance.stopReason) {
    run.fullText = "未获得可用的工具证据，当前工具执行已停止。";
    run.reportTransport(BusEvents.Transport.Delta, { textDelta: run.fullText, offset: 0 });
  }
  const cancelled = run.input.abortSignal?.aborted ?? false;
  reportStreamLoopEnded({
    report: run.report,
    trace: run.trace,
    snapshotId: run.context.currentSnapshotId,
    incomingContinuation: run.request,
    exitReason: cancelled ? "cancelled" : run.timedOut ? "timeout" : run.loopExitReason
      || (run.reconcile && run.reconciliationAttempts >= 2 ? "reconciliation_attempt_limit" : "model_step_limit"),
    toolsEnabled: run.lastStepToolsEnabled,
    todowriteAvailable: run.lastStepToolsEnabled && run.toolNames.includes("todowrite"),
    currentTodo: run.currentTodo,
    todoBefore: run.todoBefore,
    todoAfter: structuredClone([...(run.config.session?.todoState ?? [])]),
    todoHandoff: run.todoHandoff,
    reconciliationAttempts: run.reconciliationAttempts,
    streamFailed: run.streamFailed,
    cancelled,
    governance: finalGovernance,
    timedOut: run.timedOut,
    finishReason: run.finishReason || "natural",
    stepCount: run.config.stepCounter.count,
    modelStepCount: run.modelStep + 1,
    fullTextLen: run.fullText.length,
  });
  reportToolGroupComplete(run.reportTransport, run.allToolCalls);

  const overflow = resolveTokenOverflow(run);
  if (overflow.early) return overflow.early;
  const tokenOverflow = overflow.tokenOverflow;

  const intents: IntentRequest[] = run.intentData ? [toIntentRequest(run.intentData)] : [];
  const contextTokens = run.lastUsage?.totalTokens ?? 0;
  const tokenUsage: TokenUsage = { total: run.cumulativeUsage || contextTokens };
  run.config.session?.setContextTokens?.(contextTokens);
  run.fullText = sanitizeForJSON(stripToolCallMarkup(run.fullText));
  const stopReason = finalGovernance.stopReason
    ?? (run.modelStep > run.config.maxSteps + 1 ? "model_step_limit" : undefined);
  reportDone({
    report: run.report,
    outputLength: run.fullText.length,
    totalUsageTokens: tokenUsage.total,
    contextTokens,
    inputTokens: run.lastUsage?.inputTokens ?? 0,
    outputTokens: run.lastUsage?.outputTokens ?? 0,
    hasIntents: intents.length > 0,
    finishReason: run.finishReason,
    stepCount: run.config.stepCounter.count,
    modelStepCount: run.modelStep + 1,
    maxSteps: run.config.maxSteps,
    governance: finalGovernance,
    stopReason,
  });
  return {
    ...run.input,
    mode: "executing",
    responseText: run.fullText || (!run.reconcile && run.streamFailed ? "工具循环执行失败。" : ""),
    reasoningContent: run.reasoningText,
    tokenUsage,
    intents,
    todoBefore: run.todoBefore,
    currentTodo: run.currentTodo,
    todoHandoff: run.todoHandoff,
    toolStopReason: stopReason,
    streamInterrupted: run.timedOut || run.streamFailed,
    cancelled: run.input.abortSignal?.aborted ?? false,
    tokenOverflow,
    errorStatusCode: run.streamErrorCode,
    finishReason: run.finishReason,
    completeDetected: run.completeDetected,
    toolEffectSummary: summarizeToolEffects(run.allToolCalls.map(call => call.metadata)),
    contextSnapshotAccepted: !run.timedOut && !run.streamFailed,
  };
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
