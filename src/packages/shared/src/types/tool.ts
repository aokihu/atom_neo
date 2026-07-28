import type { z } from "zod";
import type { ContextEntry, ContextScope } from "./context";

export enum PermissionLevel {
  READ_ONLY = 0,
  FILE_WRITE = 1,
  FULL = 2,
}

export type ToolExecuteOptions = {
  abortSignal?: AbortSignal;
  sessionId?: string;
  evidenceQuery?: string;
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

export type ToolEffect = "none" | "reference" | "evidence" | "state_changed";

export type ToolResultMetadata =
  | {
      ok: true;
      effect: ToolEffect;
      contextInjection?: ToolContextInjection;
      error?: never;
    }
  | {
      ok: false;
      effect: "none";
      error: string;
      contextInjection?: never;
    };

export type ToolResult = {
  content?: unknown;
  metadata: ToolResultMetadata;
};
