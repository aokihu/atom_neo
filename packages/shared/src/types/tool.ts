import type { z } from "zod";

export enum PermissionLevel {
  READ_ONLY = 0,
  FILE_WRITE = 1,
  FULL = 2,
}

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  execute(args: unknown): Promise<ToolResult>;
};

export type ToolResult = {
  ok: boolean;
  output: string;
  data: unknown;
  metadata?: {
    tokensUsed?: number;
    durationMs?: number;
    permission: PermissionLevel;
  };
};
