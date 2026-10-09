import { describe, expect, mock, test } from "bun:test";
import { BusEvents, PipelineEventBus, WsMessages } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { Broadcaster } from "./broadcaster";
import { registerDecisionBridge } from "./decision-bridge";

describe("Decision bridge", () => {
  test("routes only safe Jev decision fields to the owning session", () => {
    const bus = new PipelineEventBus<FullEventMap>();
    const broadcaster = new Broadcaster();
    const owner = { send: mock(() => {}) } as any;
    const other = { send: mock(() => {}) } as any;
    broadcaster.add(owner, "session-a");
    broadcaster.add(other, "session-b");
    registerDecisionBridge(bus, broadcaster);

    bus.emit(BusEvents.Element.Data, {
      name: "jev-decision",
      payload: {
        step: "decision-updated", sessionId: "session-a", taskId: "task-a", rootTaskId: "root-a",
        purpose: "prediction", source: "jev", state: "ok", intent: "instruction",
        modelProfile: "balanced", topic: "code.debugging.issue", apiKey: "secret", probabilities: { code: 1 },
      },
    });

    expect(owner.send).toHaveBeenCalledTimes(1);
    bus.emit(BusEvents.Element.Data, { name: "jev-decision", payload: {
      step: "decision-request", sessionId: "session-a", taskId: "task-a", rootTaskId: "root-a",
      purpose: "prediction", source: "jev", state: { userInput: "private input" }, questions: { privateQuestion: {} },
    } });
    expect(owner.send).toHaveBeenCalledTimes(1);
    expect(other.send).toHaveBeenCalledTimes(0);
    const message = JSON.parse(owner.send.mock.calls[0][0]);
    expect(message.type).toBe(WsMessages.Server.DecisionUpdated);
    expect(message.payload).toEqual({
      sessionId: "session-a", taskId: "task-a", rootTaskId: "root-a", purpose: "prediction",
      source: "jev", state: "ok", intent: "instruction", modelProfile: "balanced", topic: "code.debugging.issue",
    });

    bus.emit(BusEvents.Element.Data, { name: "predict-intent", payload: { step: "decision-updated", sessionId: "session-a" } });
    expect(owner.send).toHaveBeenCalledTimes(1);
  });
});
