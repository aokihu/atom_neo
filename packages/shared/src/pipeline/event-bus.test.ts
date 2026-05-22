import { describe, test, expect, mock, beforeEach } from "bun:test";
import { PipelineEventBus } from "./event-bus";

type TestEventMap = {
  "test.event": { data: string };
  "test.count": { count: number };
};

describe("PipelineEventBus", () => {
  let bus: PipelineEventBus<TestEventMap>;

  beforeEach(() => {
    bus = new PipelineEventBus<TestEventMap>();
  });

  test("emits events to registered handlers", () => {
    const handler = mock(() => {});
    bus.on("test.event", handler);
    bus.emit("test.event", { data: "hello" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ data: "hello" });
  });

  test("returns unsubscribe function from on()", () => {
    const handler = mock(() => {});
    const off = bus.on("test.event", handler);
    off();
    bus.emit("test.event", { data: "world" });
    expect(handler).toHaveBeenCalledTimes(0);
  });

  test("supports multiple handlers for the same event", () => {
    const h1 = mock(() => {});
    const h2 = mock(() => {});
    bus.on("test.event", h1);
    bus.on("test.event", h2);
    bus.emit("test.event", { data: "x" });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  test("does not throw when emitting event with no handlers", () => {
    expect(() => bus.emit("test.event", { data: "x" })).not.toThrow();
  });

  test("does not call handlers for other events", () => {
    const handler = mock(() => {});
    bus.on("test.event", handler);
    bus.emit("test.count", { count: 42 });
    expect(handler).toHaveBeenCalledTimes(0);
  });

  test("catches handler errors and reports to error handler", () => {
    const errorHandler = mock(() => {});
    bus.onHandlerError(errorHandler);
    bus.on("test.event", () => {
      throw new Error("boom");
    });
    bus.emit("test.event", { data: "x" });
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith(
      "test.event",
      expect.any(Error),
    );
  });

  test("other handlers still run after one handler throws", () => {
    const h1 = mock(() => {
      throw new Error("boom");
    });
    const h2 = mock(() => {});
    bus.on("test.event", h1);
    bus.on("test.event", h2);
    bus.emit("test.event", { data: "x" });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  test("clear removes all handlers for an event", () => {
    const handler = mock(() => {});
    bus.on("test.event", handler);
    bus.clear("test.event");
    bus.emit("test.event", { data: "x" });
    expect(handler).toHaveBeenCalledTimes(0);
  });
});
