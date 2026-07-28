import type { SessionMessage } from "@atom-neo/shared";

type EffectSummary = {
  evidence?: number;
  referenceEvidence?: number;
  stateChanged?: number;
  none?: number;
  failed?: number;
};

export function isFailedToolAssistant(message: Pick<SessionMessage, "role" | "content" | "metadata">): boolean {
  if (message.role !== "assistant") return false;
  if (message.content.includes("<｜｜DSML｜｜tool_calls>")) return true;
  const summary = message.metadata?.toolEffectSummary as EffectSummary | undefined;
  if (!summary || message.metadata?.completeDetected !== false) return false;
  const progress = (summary.evidence ?? 0) + (summary.stateChanged ?? 0);
  const failures = (summary.none ?? 0) + (summary.failed ?? 0);
  return progress === 0 && failures > 0;
}

export function isPromptEligibleMessage(message: Pick<SessionMessage, "role" | "content" | "metadata" | "visible">): boolean {
  return message.visible !== false && !isFailedToolAssistant(message);
}
