import { WsMessages } from "../constants/events";
import type { CompactPayload, TaskCancelPayload, TaskSubmitPayload } from "./payloads";

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
