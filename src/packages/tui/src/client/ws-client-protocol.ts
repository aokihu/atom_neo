import { TaskFailureCodes, isServerEventType } from "@atom-neo/shared";
import type { ServerEvent } from "@atom-neo/shared";

export type DeltaCallback = (delta: string, offset: number) => void;
export type ReasonCallback = (delta: string, offset: number) => void;
export type ToolCallback = (event: { name: string; callId: string; input?: unknown; result?: unknown; error?: unknown }) => void;
export type ToolStepCallback = (event: { total: number; success: number; failed: number; toolNames: string[] }) => void;
export type ToolGroupCompleteCallback = (event: { total: number; success: number; failed: number; toolNames: string[] }) => void;
export type ContextTokensCallback = (total: number) => void;
export type BusyChangeCallback = (busy: boolean) => void;
export type MCPStatusCallback = (servers: { name: string; online: boolean; toolNames: string[] }[]) => void;
export type MCPConnectedCallback = (data: { servers: { name: string; online: boolean; toolCount: number }[]; toolInfos: { name: string; source: string; description: string; online: boolean }[] }) => void;

export function parseServerEvent(value: unknown): ServerEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isServerEventType(record.type)) return null;
  return { type: record.type, payload: record.payload } as ServerEvent;
}

export class TuiTaskError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    if (code === TaskFailureCodes.PipelineAborted) this.name = "TaskCancelledError";
    if (code === TaskFailureCodes.ApiKeyInvalid) this.name = "ApiKeyInvalidError";
  }
}
