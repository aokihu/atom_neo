import { BusEvents } from "@atom-neo/shared";
import type { ToolResultMetadata } from "@atom-neo/shared";
import type { ModelMessage } from "ai";
import { IntentInputSchema, retainIntentMemory } from "../../../../tools/builtin/intent";
import { stringifyToolOutput } from "../tool-loop";
import type { ManualToolCall, ToolStepRecord } from "../tool-loop";
import { validateToolCallBatch, projectToolMessages } from "../tool-loop";
import { blockToolBatch } from "./tool-batch-block";
import { applyToolOutcome } from "./tool-batch-record";
import type { StreamRun, ToolExecutionStatus } from "./types";

export type ToolBatchOutcome = {
  kind: "blocked" | "executed";
  projectedMessages: ModelMessage[];
  completedCalls: number;
  failedCalls: number;
  intentRequested: boolean;
  error?: string;
};

/** Executes one validated Tool batch, including intent and todowrite side effects. */
export async function runToolBatch(
  run: StreamRun,
  calls: readonly ManualToolCall[],
  visibleStepText: string,
  stepReasoning: string,
): Promise<ToolBatchOutcome> {
  const batchDecision = validateToolCallBatch(calls, run.config.sameToolBatchNames);
  if (!batchDecision.allowed) {
    return blockToolBatch(run, calls, batchDecision, visibleStepText, stepReasoning);
  }

  const stepRecords = new Map<string, ToolStepRecord>();
  let completedCalls = 0;
  let failedCalls = 0;
  let intentRequested = false;
  for (const [batchIndex, call] of calls.entries()) {
    const outcome = await executeBatchCall(run, call);
    stepRecords.set(call.toolCallId, outcome.record);
    if (outcome.status) applyToolOutcome(run, call, batchIndex, outcome.status);
    if (outcome.intentRequested) intentRequested = true;
    if (outcome.ok) completedCalls++;
    else failedCalls++;
  }

  return {
    kind: "executed",
    projectedMessages: projectToolMessages(calls, stepRecords, visibleStepText, stepReasoning),
    completedCalls,
    failedCalls,
    intentRequested,
  };
}

type CallOutcome = {
  record: ToolStepRecord;
  status?: ToolExecutionStatus;
  ok: boolean;
  intentRequested: boolean;
};

async function executeBatchCall(run: StreamRun, call: ManualToolCall): Promise<CallOutcome> {
  run.report(BusEvents.Element.Data, {
    step: "tool-call-start",
    toolName: call.toolName,
    stepNumber: run.modelStep,
    args: stringifyToolOutput(call.input).slice(0, 200),
  });
  run.reportTransport(BusEvents.Transport.ToolStarted, {
    toolName: call.toolName,
    toolCallId: call.toolCallId,
    input: call.input,
  });

  if (call.toolName === "intent" && !run.reconcile) {
    const parsed = IntentInputSchema.safeParse(call.input);
    const metadata: ToolResultMetadata = parsed.success
      ? { ok: true, effect: "none" } as const
      : { ok: false, effect: "none", error: "Invalid intent input", errorSource: "tool" } as const;
    run.allToolCalls.push({ toolName: call.toolName, metadata });
    if (parsed.success) {
      if (parsed.data.action === "follow_up") {
        run.intentData = parsed.data;
      } else {
        if (retainIntentMemory(run.config.memory, parsed.data.mem_id ?? "") && metadata.ok) metadata.effect = "state_changed";
      }
    }
    run.reportTransport(BusEvents.Transport.ToolFinished, {
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      result: parsed.success ? "Intent received" : undefined,
      error: parsed.success ? undefined : "Invalid intent input",
    });
    return {
      record: {
        toolName: call.toolName,
        input: call.input,
        content: parsed.success ? "Intent received" : "Invalid intent input",
        metadata,
      },
      ok: parsed.success,
      intentRequested: parsed.success && parsed.data.action === "follow_up",
    };
  }

  const status = await resolveToolStatus(run, call);
  return {
    record: { toolName: call.toolName, input: call.input, content: status.content, metadata: status.metadata },
    status,
    ok: status.metadata.ok,
    intentRequested: false,
  };
}

async function resolveToolStatus(run: StreamRun, call: ManualToolCall): Promise<ToolExecutionStatus> {
  const executor = run.availableTools[call.toolName]?.execute;
  if (typeof executor !== "function") {
    return {
      content: "",
      metadata: {
        ok: false,
        effect: "none",
        error: `No executor registered for ${call.toolName}`,
        errorSource: "runtime",
      },
    };
  }
  try {
    await executor(call.input, { abortSignal: run.signal });
    return run.config.statuses.take(call.toolName) ?? {
      content: "",
      metadata: {
        ok: false,
        effect: "none",
        error: `Executor did not report metadata for ${call.toolName}`,
        errorSource: "runtime",
      },
    };
  } catch (err: any) {
    return {
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


