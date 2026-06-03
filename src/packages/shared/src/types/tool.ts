import type { z } from "zod";

export enum PermissionLevel {
  READ_ONLY = 0,
  FILE_WRITE = 1,
  FULL = 2,
}

export type ToolExecuteOptions = {
  abortSignal?: AbortSignal;
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

export type ToolResult = {
  ok: boolean;
  output: string;
  error?: string;
  data?: unknown;
  metadata?: {
    tokensUsed?: number;
    durationMs?: number;
  };
};
