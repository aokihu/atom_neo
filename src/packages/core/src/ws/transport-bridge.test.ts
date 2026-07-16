import { describe, expect, mock, test } from "bun:test";
import { BusEvents, PipelineEventBus, WsMessages } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { Broadcaster } from "./broadcaster";
import { registerTransportBridge } from "./transport-bridge";

describe("Transport bridge", () => {
  test("routes task transport events only to the owning session", () => {
    const bus = new PipelineEventBus<FullEventMap>();
    const broadcaster = new Broadcaster();
    const sessionA = { send: mock(() => {}) } as any;
    const sessionB = { send: mock(() => {}) } as any;
    broadcaster.add(sessionA, "session-a");
    broadcaster.add(sessionB, "session-b");
    registerTransportBridge(bus, broadcaster);

    const identity = { sessionId: "session-a", taskId: "task-a" };
    bus.emit(BusEvents.Transport.Reason, {
      name: "stream-llm",
      payload: { ...identity, textDelta: "reason", offset: 0 },
    });
    bus.emit(BusEvents.Transport.Delta, {
      name: "stream-llm",
      payload: { ...identity, textDelta: "answer", offset: 0 },
    });
    bus.emit(BusEvents.Transport.ToolStarted, {
      name: "stream-llm",
      payload: { ...identity, toolName: "search", toolCallId: "call-1", input: {} },
    });
    bus.emit(BusEvents.Transport.ToolFinished, {
      name: "stream-llm",
      payload: { ...identity, toolName: "search", toolCallId: "call-1", result: "ok" },
    });
    bus.emit(BusEvents.Transport.ToolStepFinished, {
      name: "stream-llm",
      payload: { ...identity, stepNumber: 1, total: 1, success: 1, failed: 0, toolNames: ["search"] },
    });
    bus.emit(BusEvents.Transport.ToolGroupComplete, {
      name: "stream-llm",
      payload: { ...identity, total: 1, success: 1, failed: 0, toolNames: ["search"] },
    });

    expect(sessionA.send).toHaveBeenCalledTimes(6);
    expect(sessionB.send).toHaveBeenCalledTimes(0);

    const messages = sessionA.send.mock.calls.map(([value]: [string]) => JSON.parse(value));
    expect(messages.map((message: { type: string }) => message.type)).toEqual([
      WsMessages.Server.TransportReason,
      WsMessages.Server.TransportDelta,
      WsMessages.Server.TransportToolStarted,
      WsMessages.Server.TransportToolFinished,
      WsMessages.Server.TransportToolStepFinished,
      WsMessages.Server.TransportToolGroupComplete,
    ]);
    for (const message of messages) {
      expect(message.payload.sessionId).toBe("session-a");
      expect(message.payload.taskId).toBe("task-a");
    }
  });

  test("does not broadcast empty text events", () => {
    const bus = new PipelineEventBus<FullEventMap>();
    const broadcaster = new Broadcaster();
    const client = { send: mock(() => {}) } as any;
    broadcaster.add(client, "session-a");
    registerTransportBridge(bus, broadcaster);

    const identity = { sessionId: "session-a", taskId: "task-a" };
    bus.emit(BusEvents.Transport.Reason, {
      name: "stream-llm",
      payload: { ...identity, textDelta: "", offset: 0 },
    });
    bus.emit(BusEvents.Transport.Delta, {
      name: "stream-llm",
      payload: { ...identity, textDelta: "", offset: 0 },
    });

    expect(client.send).toHaveBeenCalledTimes(0);
  });
});
