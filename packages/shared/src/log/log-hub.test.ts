import { describe, test, expect, mock } from "bun:test";
import { LogHub } from "./log-hub";
import type { LogEntry, LogSink } from "./types";

describe("LogHub", () => {
  test("writes to all registered sinks", () => {
    const hub = new LogHub();
    const s1: LogSink = { write: mock(() => {}) };
    const s2: LogSink = { write: mock(() => {}) };

    hub.addSink(s1);
    hub.addSink(s2);

    const entry: LogEntry = {
      level: "info",
      message: "hello",
      timestamp: 123,
    };
    hub.write(entry);

    expect(s1.write).toHaveBeenCalledTimes(1);
    expect(s2.write).toHaveBeenCalledTimes(1);
  });

  test("returns unsubscribe function from addSink", () => {
    const hub = new LogHub();
    const sink: LogSink = { write: mock(() => {}) };

    const off = hub.addSink(sink);

    const entry: LogEntry = {
      level: "info",
      message: "hello",
      timestamp: 123,
    };
    hub.write(entry);
    expect(sink.write).toHaveBeenCalledTimes(1);

    off();
    hub.write(entry);
    expect(sink.write).toHaveBeenCalledTimes(1);
  });

  test("does not propagate sink errors", () => {
    const hub = new LogHub();
    const badSink: LogSink = {
      write: () => {
        throw new Error("sink error");
      },
    };
    const goodSink: LogSink = { write: mock(() => {}) };

    hub.addSink(badSink);
    hub.addSink(goodSink);

    expect(() =>
      hub.write({ level: "info", message: "test", timestamp: 0 }),
    ).not.toThrow();
    expect(goodSink.write).toHaveBeenCalledTimes(1);
  });
});
