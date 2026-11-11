import { WsMessages } from "./constants/events";
import type { TransportEventIdentity } from "./types/pipeline";
import type { SessionMessage, SessionTelemetry } from "./types/session";
import type { TaskSource, TaskState, TaskToolReport } from "./types/task";

// Client → Core
export type ClientEvent =
  | {
      type: typeof WsMessages.Client.TaskSubmit;
      payload: TaskSubmitPayload;
    }
  | {
      type: typeof WsMessages.Client.TaskCancel;
      payload: TaskCancelPayload;
    }
  | {
      type: typeof WsMessages.Client.Compact;
      payload?: CompactPayload;
    }
  | {
      type: typeof WsMessages.Control.Ping;
      payload?: Record<string, never>;
    };

export type ClientEventType = ClientEvent["type"];

export const CLIENT_EVENT_TYPES = [
  WsMessages.Client.TaskSubmit,
  WsMessages.Client.TaskCancel,
  WsMessages.Client.Compact,
  WsMessages.Control.Ping,
] as const satisfies readonly ClientEventType[];

const CLIENT_EVENT_TYPE_SET: ReadonlySet<string> = new Set(CLIENT_EVENT_TYPES);

export function isClientEventType(value: unknown): value is ClientEventType {
  return typeof value === "string" && CLIENT_EVENT_TYPE_SET.has(value);
}

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

// Core → Client (broadcast)
export type ServerEvent =
  | {
      type: typeof WsMessages.Server.SessionReady;
      payload: SessionReadyPayload;
    }
  | {
      type: typeof WsMessages.Server.SessionTelemetry;
      payload: SessionTelemetry;
    }
  | {
      type: typeof WsMessages.Server.TaskCreated;
      payload: TaskCreatedPayload;
    }
  | {
      type: typeof WsMessages.Server.TaskCompleted;
      payload: TaskCompletedPayload;
    }
  | {
      type: typeof WsMessages.Server.TaskFailed;
      payload: TaskFailedPayload;
    }
  | {
      type: typeof WsMessages.Server.TaskStateChanged;
      payload: TaskStatePayload;
    }
  | {
      type: typeof WsMessages.Server.TransportDelta;
      payload: TransportDeltaPayload;
    }
  | {
      type: typeof WsMessages.Server.TransportReason;
      payload: TransportReasonPayload;
    }
  | {
      type: typeof WsMessages.Server.TransportToolStarted;
      payload: ToolStartedPayload;
    }
  | {
      type: typeof WsMessages.Server.TransportToolFinished;
      payload: ToolFinishedPayload;
    }
  | {
      type: typeof WsMessages.Server.TransportToolStepFinished;
      payload: ToolStepFinishedPayload;
    }
  | {
      type: typeof WsMessages.Server.TransportToolGroupComplete;
      payload: ToolGroupCompletePayload;
    }
  | {
      type: typeof WsMessages.Server.SessionTaskActive;
      payload: SessionTaskActivePayload;
    }
  | {
      type: typeof WsMessages.Server.MCPConnected;
      payload: MCPConnectedPayload;
    }
  | {
      type: typeof WsMessages.Server.MCPToolStatus;
      payload: MCPToolStatusPayload;
    }
  | {
      type: typeof WsMessages.Server.PipelineElementStarted;
      payload: ElementStartedPayload;
    }
  | {
      type: typeof WsMessages.Server.PipelineElementFinished;
      payload: ElementFinishedPayload;
    }
  | {
      type: typeof WsMessages.Server.DecisionUpdated;
      payload: DecisionUpdatePayload;
    }
  | {
      type: typeof WsMessages.Server.ReplayStart;
      payload: ReplayStartPayload;
    }
  | {
      type: typeof WsMessages.Server.ReplayEnd;
      payload: ReplayEndPayload;
    }
  | {
      type: typeof WsMessages.Control.Pong;
      payload: Record<string, never>;
    }
  | {
      type: typeof WsMessages.Control.Error;
      payload: ControlErrorPayload;
    };

export type ServerEventType = ServerEvent["type"];

export const SERVER_EVENT_TYPES = [
  WsMessages.Server.SessionReady,
  WsMessages.Server.SessionTelemetry,
  WsMessages.Server.TaskCreated,
  WsMessages.Server.TaskCompleted,
  WsMessages.Server.TaskFailed,
  WsMessages.Server.TaskStateChanged,
  WsMessages.Server.TransportDelta,
  WsMessages.Server.TransportReason,
  WsMessages.Server.TransportToolStarted,
  WsMessages.Server.TransportToolFinished,
  WsMessages.Server.TransportToolStepFinished,
  WsMessages.Server.TransportToolGroupComplete,
  WsMessages.Server.SessionTaskActive,
  WsMessages.Server.MCPConnected,
  WsMessages.Server.MCPToolStatus,
  WsMessages.Server.PipelineElementStarted,
  WsMessages.Server.PipelineElementFinished,
  WsMessages.Server.DecisionUpdated,
  WsMessages.Server.ReplayStart,
  WsMessages.Server.ReplayEnd,
  WsMessages.Control.Pong,
  WsMessages.Control.Error,
] as const satisfies readonly ServerEventType[];

const SERVER_EVENT_TYPE_SET: ReadonlySet<string> = new Set(SERVER_EVENT_TYPES);

export function isServerEventType(value: unknown): value is ServerEventType {
  return typeof value === "string" && SERVER_EVENT_TYPE_SET.has(value);
}

/** Payload type for a specific server event discriminant. */
export type ServerEventPayload<K extends ServerEventType> = Extract<ServerEvent, { type: K }>["payload"];

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
