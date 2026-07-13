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

export type ToolResult = {
  ok: boolean;
  output: string;
  error?: string;
  data?: unknown;
  contextInjection?: ToolContextInjection;
  metadata?: {
    tokensUsed?: number;
    durationMs?: number;
  };
};
