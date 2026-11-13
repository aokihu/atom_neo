import { WsMessages } from "../constants/events";
import type { SessionTelemetry } from "../types/session";
import type {
  ControlErrorPayload,
  DecisionUpdatePayload,
  ElementFinishedPayload,
  ElementStartedPayload,
  MCPConnectedPayload,
  MCPToolStatusPayload,
  ReplayEndPayload,
  ReplayStartPayload,
  SessionReadyPayload,
  SessionTaskActivePayload,
  TaskCompletedPayload,
  TaskCreatedPayload,
  TaskFailedPayload,
  TaskStatePayload,
  ToolFinishedPayload,
  ToolGroupCompletePayload,
  ToolStartedPayload,
  ToolStepFinishedPayload,
  TransportDeltaPayload,
  TransportReasonPayload,
} from "./payloads";

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

/** Payload type for a specific server event discriminant. */
export type ServerEventPayload<K extends ServerEventType> = Extract<ServerEvent, { type: K }>["payload"];
