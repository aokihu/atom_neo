import { BusEvents } from "@atom-neo/shared";
import { calcTokenRatio } from "@core/pipelines/shared";
import type { ConversationFlowState } from "../types";
import type { StreamRun } from "./types";

/** Returns an early result when the configured context is already over the 0.8 threshold. */
export function resolveTokenOverflow(run: StreamRun): {
  tokenOverflow: boolean;
  early?: ConversationFlowState;
} {
  if (!(run.finishReason !== "length" && !run.reconcile && !run.timedOut
    && run.config.stepCounter.count === 0 && run.fullText.length === 0 && !run.streamFailed)) {
    return { tokenOverflow: false };
  }
  const tu = run.config.session?.contextTokens ?? 0;
  const ratio = calcTokenRatio(tu, run.config.configContextLimit, run.config.maxTokens);
  const effectiveLimit = run.config.configContextLimit - run.config.maxTokens;
  if (ratio <= 0.8) {
    run.report(BusEvents.Element.Data, { step: "stream-error-not-overflow", ratio: +ratio.toFixed(3), tu, effectiveLimit });
    return { tokenOverflow: false };
  }
  run.report(BusEvents.Element.Data, {
    step: "token-overflow-detected",
    taskIntent: run.config.taskIntent,
    msgCount: run.userMessages.length,
    toolCount: run.toolNames.length,
    ratio: +ratio.toFixed(3),
    tu,
    effectiveLimit,
  });
  return {
    tokenOverflow: true,
    early: {
      ...run.input,
      mode: "executing",
      responseText: "",
      reasoningContent: "",
      tokenUsage: { total: 0 },
      intents: [],
      tokenOverflow: true,
      contextSnapshotAccepted: false,
    },
  };
}
