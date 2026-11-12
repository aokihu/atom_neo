import { BusEvents } from "@atom-neo/shared";
import { streamText } from "ai";
import type { ManualToolCall } from "../tool-loop";
import { findTodoTarget } from "@core/session/context";
import {
  reportModelStepEnded,
  reportModelStepUsage,
} from "./stream-reporting";
import {
  reportStreamAbort,
  reportStreamLlmError,
  reportUsageError,
} from "./stream-reporting-events";
import type { ChunkClassification, ModelUsage, StepOutcome, StreamDeadlineLike, StreamRun } from "./types";

export function resolveTimeout(difficulty: string): number {
  switch (difficulty) {
    case "mygod": return 1_800_000;
    case "hard":  return 900_000;
    case "medium": return 600_000;
    default:      return 300_000;
  }
}

/** Pauses the model-step timeout while `beforeCall` runs, then re-arms the remainder. */
export class StreamDeadline implements StreamDeadlineLike {
  #remainingMs: number;
  #startedAt: number;
  #timer: ReturnType<typeof setTimeout>;
  #onTimeout: () => void;

  constructor(timeoutMs: number, onTimeout: () => void) {
    this.#remainingMs = timeoutMs;
    this.#startedAt = Date.now();
    this.#onTimeout = onTimeout;
    this.#timer = setTimeout(onTimeout, timeoutMs);
  }

  async pauseForBeforeCall(
    beforeCall: (signal?: AbortSignal) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    clearTimeout(this.#timer);
    this.#remainingMs = Math.max(0, this.#remainingMs - (Date.now() - this.#startedAt));
    try {
      await beforeCall(signal);
    } finally {
      this.#startedAt = Date.now();
      this.#timer = setTimeout(this.#onTimeout, this.#remainingMs);
    }
  }

  dispose(): void {
    clearTimeout(this.#timer);
  }
}

/** Classifies one SDK stream part without reporting or mutating run state. */
export function consumeStreamChunk(
  part: any,
  state: { stepNumber: number; callCount: number; reasoningOffset: number },
): ChunkClassification {
  if (part.type === "reasoning-delta" || part.type === "reasoning") {
    const text = part.textDelta ?? part.text ?? "";
    return text ? { kind: "reasoning", text, offset: state.reasoningOffset } : { kind: "ignore" };
  }
  if (part.type === "text-delta") {
    return { kind: "text", text: part.text ?? "" };
  }
  if (part.type === "tool-call") {
    return {
      kind: "tool-call",
      call: {
        toolCallId: part.toolCallId ?? `manual-${state.stepNumber}-${state.callCount}`,
        toolName: part.toolName,
        input: part.input ?? part.args,
      },
    };
  }
  if (part.type === "finish" || part.type === "finish-step") {
    return { kind: "finish", finishReason: part.finishReason };
  }
  if (part.type === "error") {
    const error = part.error ?? {};
    return { kind: "error", statusCode: error.statusCode, error };
  }
  if (part.type === "abort") {
    return { kind: "abort" };
  }
  return { kind: "ignore" };
}

type StepStreamResult = {
  text: string;
  reasoning: string;
  calls: ManualToolCall[];
  finishReason: string;
  failed: boolean;
  errorCode: number;
};

/** Runs one model step: beforeCall, streamText, chunk consumption, and usage. */
export async function runModelStep(
  run: StreamRun,
  params: { instructions: string; forceText: boolean },
): Promise<StepOutcome> {
  if (run.config.beforeCall) {
    await run.deadline.pauseForBeforeCall(run.config.beforeCall, run.signal);
    run.signal.throwIfAborted();
  }
  const streamResult = streamText({
    model: run.model,
    instructions: params.instructions || undefined,
    messages: run.modelMessages,
    tools: !params.forceText && run.toolNames.length > 0 ? run.modelTools : undefined,
    maxOutputTokens: run.config.maxTokens,
    providerOptions: run.config.providerOptions,
    abortSignal: run.signal,
  });
  const step = await consumeModelStream(streamResult, run);
  const usage = await settleModelStepUsage(run, streamResult, step.failed, step.finishReason, params.forceText);
  reportModelStepEnded({
    report: run.report,
    trace: run.trace,
    snapshotId: run.context.currentSnapshotId,
    toolsEnabled: run.lastStepToolsEnabled,
    todowriteAvailable: run.lastStepToolsEnabled && run.toolNames.includes("todowrite"),
    forceText: params.forceText,
    currentTodo: run.currentTodo,
    currentTodoState: findTodoTarget(run.config.session?.todoState ?? [], run.currentTodo),
    stepNumber: run.modelStep,
    finishReason: usage.finishReason || "natural",
    toolCallCount: step.calls.length,
    textLength: step.text.length,
  });
  return {
    text: step.text,
    reasoning: step.reasoning,
    calls: step.calls,
    usage: usage.lastUsage,
    cumulativeUsage: usage.cumulativeUsage,
    finishReason: usage.finishReason,
    failed: usage.failed,
    errorCode: step.errorCode,
  };
}

async function consumeModelStream(
  streamResult: ReturnType<typeof streamText>,
  run: StreamRun,
): Promise<StepStreamResult> {
  const calls: ManualToolCall[] = [];
  let text = "";
  let reasoning = "";
  let finishReason = run.finishReason;
  let failed = run.streamFailed;
  let errorCode = run.streamErrorCode;

  for await (const chunk of streamResult.stream) {
    const classified = consumeStreamChunk(chunk, {
      stepNumber: run.modelStep,
      callCount: calls.length,
      reasoningOffset: run.transportReasoningLength,
    });
    if (classified.kind === "reasoning") {
      reasoning += classified.text;
      run.transportReasoningLength += classified.text.length;
      run.reportTransport(BusEvents.Transport.Reason, { textDelta: classified.text, offset: classified.offset });
    } else if (classified.kind === "text") {
      text += classified.text;
    } else if (classified.kind === "tool-call") {
      calls.push(classified.call);
    } else if (classified.kind === "finish") {
      finishReason = classified.finishReason ?? finishReason;
    } else if (classified.kind === "error") {
      finishReason = "error";
      failed = true;
      if (classified.statusCode) errorCode = classified.statusCode;
      reportStreamLlmError(run.report, classified.error);
    } else if (classified.kind === "abort") {
      finishReason = "error";
      failed = true;
      reportStreamAbort(run.report);
    }
  }
  return { text, reasoning, calls, finishReason, failed, errorCode };
}

async function settleModelStepUsage(
  run: StreamRun,
  streamResult: ReturnType<typeof streamText>,
  failed: boolean,
  finishReason: string,
  forceText: boolean,
): Promise<{
  lastUsage: ModelUsage | undefined;
  cumulativeUsage: number;
  finishReason: string;
  failed: boolean;
}> {
  let usageTimer: ReturnType<typeof setTimeout> | undefined;
  let lastUsage: ModelUsage | undefined = run.lastUsage;
  let cumulativeUsage = run.cumulativeUsage;
  let nextFailed = failed;
  let nextFinishReason = finishReason;
  try {
    lastUsage = await Promise.race([
      streamResult.usage,
      new Promise<never>((_, reject) =>
        usageTimer = setTimeout(() => reject(new Error("streamResult usage timeout")), 30_000)
      ),
    ]);
    cumulativeUsage += lastUsage?.totalTokens ?? 0;
    reportModelStepUsage({
      report: run.report,
      model: run.config.model,
      stepNumber: run.modelStep,
      snapshotId: run.context.currentSnapshotId,
      usage: lastUsage,
      toolDefinitionsHash: run.toolDefinitionsHash,
      forceText,
      currentSystemText: run.context.systemText,
    });
    run.context.commit(nextFailed, run.timedOut, run.signal);
  } catch (err: any) {
    nextFailed = true;
    nextFinishReason = "error";
    reportUsageError(run.report, err);
  } finally {
    clearTimeout(usageTimer);
  }
  return { lastUsage, cumulativeUsage, finishReason: nextFinishReason, failed: nextFailed };
}
