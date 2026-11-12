import { WsMessages } from "../constants/events";
import type { ClientEventType } from "./client-events";
import type { ServerEventType } from "./server-events";

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
