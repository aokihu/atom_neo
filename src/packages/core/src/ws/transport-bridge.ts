import { BusEvents, WsMessages } from "@atom-neo/shared";
import type { FullEventMap, PipelineEventBus } from "@atom-neo/shared";
import type { Broadcaster } from "./broadcaster";

type TransportPayload = {
  sessionId: string;
  taskId: string;
  [key: string]: unknown;
};

export function registerTransportBridge(
  bus: PipelineEventBus<FullEventMap>,
  broadcaster: Broadcaster,
): void {
  const send = (type: string, payload: TransportPayload) => {
    broadcaster.broadcastToSession(payload.sessionId, {
      type,
      ts: Date.now(),
      seq: 0,
      payload,
    });
  };

  bus.on(BusEvents.Transport.Reason, ({ payload }) => {
    if (payload.textDelta) send(WsMessages.Server.TransportReason, payload);
  });
  bus.on(BusEvents.Transport.Delta, ({ payload }) => {
    if (payload.textDelta) send(WsMessages.Server.TransportDelta, payload);
  });
  bus.on(BusEvents.Transport.ToolStarted, ({ payload }) => {
    send(WsMessages.Server.TransportToolStarted, payload);
  });
  bus.on(BusEvents.Transport.ToolFinished, ({ payload }) => {
    send(WsMessages.Server.TransportToolFinished, payload);
  });
  bus.on(BusEvents.Transport.ToolStepFinished, ({ payload }) => {
    send(WsMessages.Server.TransportToolStepFinished, payload);
  });
  bus.on(BusEvents.Transport.ToolGroupComplete, ({ payload }) => {
    send(WsMessages.Server.TransportToolGroupComplete, payload);
  });
}
