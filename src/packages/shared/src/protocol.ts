/**
 * Protocol barrel.
 *
 * The wire-event unions, payload types, and runtime guards live in
 * `./protocol/*`. This module preserves the original import surface, so
 * consumers keep importing every protocol type and guard from `./protocol`.
 */

export { CLIENT_EVENT_TYPES, SERVER_EVENT_TYPES, isClientEventType, isServerEventType } from "./protocol/guards";
export type { ClientEvent, ClientEventType } from "./protocol/client-events";
export type { ServerEvent, ServerEventType, ServerEventPayload } from "./protocol/server-events";
export type {
  TaskSubmitPayload,
  TaskCancelPayload,
  CompactPayload,
  SessionReadyPayload,
  TaskCreatedPayload,
  SessionTaskActivePayload,
  MCPConnectedPayload,
  MCPToolStatusPayload,
  ControlErrorPayload,
  ElementStartedPayload,
  ElementFinishedPayload,
  DecisionUpdatePayload,
  TransportReasonPayload,
  TransportDeltaPayload,
  ToolStartedPayload,
  ToolFinishedPayload,
  ToolStepFinishedPayload,
  ToolGroupCompletePayload,
  TaskCompletedPayload,
  TaskFailedPayload,
  TaskStatePayload,
  ReplayStartPayload,
  ReplayEndPayload,
} from "./protocol/payloads";
