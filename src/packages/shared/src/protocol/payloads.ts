import type { TransportEventIdentity } from "../types/pipeline";
import type { SessionMessage, SessionTelemetry } from "../types/session";
import type { TaskSource, TaskState, TaskToolReport } from "../types/task";

// ── Client → Core payloads ──

export type TaskSubmitPayload = {
  /** Accepted for compatibility; the WebSocket URL session is authoritative. */
  sessionId?: string;
  chatId?: string;
  pipeline?: string;
  source?: TaskSource;
  data?: {
    text?: string;
    toolReport?: TaskToolReport;
  };
};

export type TaskCancelPayload = {
  taskId: string;
};

export type CompactPayload = Record<string, never>;

// ── Core → Client payloads ──

export type SessionReadyPayload = {
  sessionId: string;
  messages: SessionMessage[];
  contextTokens: number;
  activeTaskIds: string[];
  telemetry: SessionTelemetry;
};

export type TaskCreatedPayload = {
  taskId: string;
  state: TaskState;
};

export type SessionTaskActivePayload = {
  active: boolean;
  taskId: string;
};

export type MCPConnectedPayload = {
  servers: { name: string; online: boolean; toolCount: number }[];
  toolInfos: { name: string; source: string; description: string; online: boolean }[];
};

export type MCPToolStatusPayload = {
  servers: { name: string; online: boolean; toolNames: string[] }[];
};

export type ControlErrorPayload = {
  message: string;
  code?: string;
};

export type ElementStartedPayload = {
  pipelineName: string;
  elementName: string;
  elementKind: string;
};

export type ElementFinishedPayload = {
  pipelineName: string;
  elementName: string;
  elementKind: string;
  durationMs: number;
};

export type DecisionUpdatePayload = {
  sessionId: string;
  taskId: string;
  rootTaskId: string;
  purpose: "prediction" | "post-conversation";
  source: "jev" | "llm";
  state: "run" | "ok" | "err";
  intent?: string;
  modelProfile?: string;
  topic?: string;
  analysisStatus?: string;
};

export type TransportReasonPayload = TransportEventIdentity & {
  textDelta: string;
  offset: number;
};

export type TransportDeltaPayload = TransportEventIdentity & {
  textDelta: string;
  offset: number;
};

export type ToolStartedPayload = TransportEventIdentity & {
  toolName: string;
  toolCallId: string;
  input: unknown;
};

export type ToolFinishedPayload = TransportEventIdentity & {
  toolName: string;
  toolCallId: string;
  result?: unknown;
  error?: unknown;
};

export type ToolStepFinishedPayload = TransportEventIdentity & {
  stepNumber: number;
  total: number;
  success: number;
  failed: number;
  toolNames: string[];
};

export type ToolGroupCompletePayload = TransportEventIdentity & {
  total: number;
  success: number;
  failed: number;
  toolNames: string[];
};

export type TaskCompletedPayload = {
  taskId: string;
  rootTaskId: string;
  parentTaskId: string | null;
  terminal: boolean;
  output: string;
  reasoningContent: string;
  tokenUsage: { total: number };
  contextTokens: number;
};

export type TaskFailedPayload = {
  taskId: string;
  rootTaskId: string;
  code?: string;
  error: string;
};

export type TaskStatePayload = {
  taskId: string;
  previousState?: TaskState;
  currentState: TaskState;
};

export type ReplayStartPayload = {
  taskId: string;
  eventCount: number;
};

export type ReplayEndPayload = {
  taskId: string;
  durationMs: number;
};
