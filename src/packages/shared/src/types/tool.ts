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
  taskId?: string;
  chatId?: string;
  evidenceQuery?: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  source: "builtin" | "plugin" | "mcp";
  inputSchema: z.ZodType<Record<string, unknown>>;
  execute(args: unknown, opts?: ToolExecuteOptions): Promise<ToolResult>;
  permission?: PermissionLevel;
  allowSameToolBatch?: boolean;
  recordPolicy?: "record" | "exclude";
  requiresApproval?: boolean;
  silent?: boolean;
};

export type ToolContextInjection = {
  scope: Extract<ContextScope, "session" | "topic" | "task" | "step">;
  entry: Omit<ContextEntry, "revision">;
};

export type ToolEffect = "none" | "reference" | "evidence" | "state_changed";
export type ToolErrorSource = "guard" | "runtime" | "tool";

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
      errorSource: ToolErrorSource;
      contextInjection?: never;
    };

export type ToolResult = {
  content?: unknown;
  metadata: ToolResultMetadata;
};

export type ToolRecordStatus = "success" | "failed";

export type ToolRecord = {
  id: string;
  toolsGroupId: string;
  step: number;
  modelStep: number;
  batchIndex: number;
  toolCallId: string;
  toolName: string;
  source: ToolDefinition["source"];
  startedAt: number;
  durationMs: number;
  input: unknown;
  inputSummary: string;
  output?: unknown;
  resultSummary: string;
  metadata: ToolResultMetadata;
  truncated?: boolean;
};

export type ToolsGroupStatus = "active" | "sealed" | "interrupted";

export type ToolsGroup = {
  id: string;
  sessionId: string;
  taskId: string;
  topic: string;
  createdAt: number;
  sealedAt?: number;
  status: ToolsGroupStatus;
  records: ToolRecord[];
  summary: string;
};

export type ToolRecordSummary = {
  id: string;
  step: number;
  tool: string;
  status: ToolRecordStatus;
  input: string;
  result: string;
};

export type ToolsGroupSummary = {
  id: string;
  topic: string;
  createdAt: number;
  status: Exclude<ToolsGroupStatus, "active">;
  steps: string;
  tools: string;
  success: number;
  failed: number;
  summary: string;
};
