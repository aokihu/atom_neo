import type { z } from "zod";

export enum PermissionLevel {
  READ_ONLY = 0,
  FILE_WRITE = 1,
  FULL = 2,
}

export type ToolDefinition = {
  name: string;
  description: string;
  source: "builtin" | "plugin" | "mcp";
  inputSchema: z.ZodType<Record<string, unknown>>;
  execute(args: unknown): Promise<ToolResult>;
  permission?: PermissionLevel;
  requiresApproval?: boolean;
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
