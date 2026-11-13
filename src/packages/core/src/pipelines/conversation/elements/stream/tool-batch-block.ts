import { BusEvents } from "@atom-neo/shared";
import type { ManualToolCall, ToolStepRecord } from "../tool-loop";
import { formatToolBatchBlock, projectToolMessages, validateToolCallBatch } from "../tool-loop";
import type { ToolBatchOutcome } from "./tool-batch";
import type { StreamRun } from "./types";

export function blockToolBatch(
  run: StreamRun,
  calls: readonly ManualToolCall[],
  decision: Extract<ReturnType<typeof validateToolCallBatch>, { allowed: false }>,
  visibleStepText: string,
  stepReasoning: string,
): ToolBatchOutcome {
  const error = formatToolBatchBlock(decision);
  const metadata = { ok: false, effect: "none", error, errorSource: "guard" } as const;
  const stepRecords = new Map<string, ToolStepRecord>();
  const governanceState = run.config.governance.current.rejectBatch(calls.length);
  run.report(BusEvents.Element.Data, {
    step: "tool-batch-blocked",
    stepNumber: run.modelStep,
    reason: decision.reason,
    toolNames: decision.toolNames,
    callCount: calls.length,
    ...governanceState,
  });
  for (const call of calls) {
    stepRecords.set(call.toolCallId, {
      toolName: call.toolName,
      input: call.input,
      content: "",
      metadata,
    });
    run.allToolCalls.push({ toolName: call.toolName, metadata });
    run.reportTransport(BusEvents.Transport.ToolStarted, {
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      input: call.input,
    });
    run.reportTransport(BusEvents.Transport.ToolFinished, {
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      error,
    });
  }
  return {
    kind: "blocked",
    projectedMessages: projectToolMessages(calls, stepRecords, visibleStepText, stepReasoning),
    completedCalls: 0,
    failedCalls: calls.length,
    intentRequested: false,
    error,
  };
}
