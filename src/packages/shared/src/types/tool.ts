import type { z } from "zod";
import type { ContextEntry, ContextScope } from "./context";

export enum PermissionLevel {
  READ_ONLY = 0,
  FILE_WRITE = 1,
  FULL = 2,
}

export type ToolGuardDecision = {
  allowed: boolean;
  reason: string;
  message?: string;
};

export type ToolGuardState = Readonly<Record<string, ToolGuardDecision>>;

export type ToolExecuteOptions = {
  abortSignal?: AbortSignal;
  sessionId?: string;
  guardState?: ToolGuardState;
};

export type ToolDefinition = {
  name: string;
  description: string;
  source: "builtin" | "plugin" | "mcp";
  inputSchema: z.ZodType<Record<string, unknown>>;
  execute(args: unknown, opts?: ToolExecuteOptions): Promise<ToolResult>;
  permission?: PermissionLevel;
  requiresApproval?: boolean;
  silent?: boolean;
};

export type ToolContextInjection = {
  scope: Extract<ContextScope, "session" | "topic" | "task" | "step">;
  entry: Omit<ContextEntry, "revision">;
};

export type ToolOutcomeStatus =
  | "success"
  | "empty"
  | "error"
  | "blocked"
  | "deferred"
  | "cancelled";

export type ToolProgress = "evidence" | "state_changed" | "none";

export type ToolOutcome = {
  status: ToolOutcomeStatus;
  progress: ToolProgress;
  evidenceWeight?: "primary" | "reference";
  code?: string;
};

export type ToolResult = {
  ok: boolean;
  output: string;
  error?: string;
  data?: unknown;
  outcome?: ToolOutcome;
  contextInjection?: ToolContextInjection;
  metadata?: {
    tokensUsed?: number;
    durationMs?: number;
  };
};

export function resolveToolOutcome(result: Pick<ToolResult, "ok" | "data" | "outcome">): ToolOutcome {
  if (result.outcome) return result.outcome;
  if (
    result.ok
    && typeof result.data === "object"
    && result.data !== null
    && (result.data as { status?: unknown }).status === "deferred"
  ) {
    return { status: "deferred", progress: "none" };
  }
  return result.ok
    ? { status: "success", progress: "evidence" }
    : { status: "error", progress: "none" };
}
