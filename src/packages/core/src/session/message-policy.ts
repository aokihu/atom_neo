import type { SessionMessage } from "@atom-neo/shared";

type OutcomeSummary = {
  evidence?: number;
  referenceEvidence?: number;
  stateChanged?: number;
  empty?: number;
  error?: number;
  blocked?: number;
  deferred?: number;
  cancelled?: number;
};

export function isFailedToolAssistant(message: Pick<SessionMessage, "role" | "content" | "metadata">): boolean {
  if (message.role !== "assistant") return false;
  if (message.content.includes("<｜｜DSML｜｜tool_calls>")) return true;
  const summary = message.metadata?.toolOutcomeSummary as OutcomeSummary | undefined;
  if (!summary || message.metadata?.completeDetected !== false) return false;
  const progress = (summary.evidence ?? 0) + (summary.stateChanged ?? 0);
  const failures = (summary.empty ?? 0)
    + (summary.error ?? 0)
    + (summary.blocked ?? 0)
    + (summary.deferred ?? 0)
    + (summary.cancelled ?? 0);
  return progress === 0 && failures > 0;
}

export function isPromptEligibleMessage(message: Pick<SessionMessage, "role" | "content" | "metadata" | "visible">): boolean {
  return message.visible !== false && !isFailedToolAssistant(message);
}
