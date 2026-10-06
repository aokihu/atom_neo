import { BusEvents, WsMessages } from "@atom-neo/shared";
import type { DecisionUpdatePayload, FullEventMap, PipelineEventBus } from "@atom-neo/shared";
import type { Broadcaster } from "./broadcaster";

export function registerDecisionBridge(bus: PipelineEventBus<FullEventMap>, broadcaster: Broadcaster): void {
  bus.on(BusEvents.Element.Data, ({ name, payload }) => {
    if (name !== "jev-decision" || payload.step !== "decision-updated") return;
    const { sessionId, taskId, rootTaskId, purpose, source, state } = payload;
    if (typeof sessionId !== "string" || typeof taskId !== "string" || typeof rootTaskId !== "string") return;
    if (purpose !== "prediction" && purpose !== "post-conversation") return;
    if (source !== "jev" && source !== "llm") return;
    if (state !== "run" && state !== "ok" && state !== "err") return;

    const update: DecisionUpdatePayload = { sessionId, taskId, rootTaskId, purpose, source, state };
    if (state === "ok" && purpose === "prediction") {
      if (typeof payload.intent === "string") update.intent = payload.intent;
      if (typeof payload.modelProfile === "string") update.modelProfile = payload.modelProfile;
      if (typeof payload.topic === "string") update.topic = payload.topic;
    }
    if (state === "ok" && purpose === "post-conversation" && typeof payload.analysisStatus === "string") {
      update.analysisStatus = payload.analysisStatus;
    }
    broadcaster.broadcastToSession(sessionId, WsMessages.Server.DecisionUpdated, update);
  });
}
