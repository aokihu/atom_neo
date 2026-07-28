import type { ToolOutcome } from "@atom-neo/shared";

export const TOOL_OUTCOMES = {
  evidence: { status: "success", progress: "evidence" },
  stateChanged: { status: "success", progress: "state_changed" },
  empty: { status: "empty", progress: "none" },
  error: { status: "error", progress: "none" },
  cancelled: { status: "cancelled", progress: "none" },
} as const satisfies Record<string, ToolOutcome>;
