import { describe, test, expect, mock } from "bun:test";
import { Logger } from "./logger";
import type { LogEntry } from "./types";

describe("Logger", () => {
  test("writes log with correct level and message", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger("debug", (e) => entries.push(e));
    logger.info("test message");
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe("info");
    expect(entries[0].message).toBe("test message");
  });

  test("respects log level filter", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger("warn", (e) => entries.push(e));
    logger.debug("debug msg");
    logger.info("info msg");
    logger.warn("warn msg");
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe("warn");
  });

  test("includes context in log entry", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger("debug", (e) => entries.push(e));
    logger.info("ctx test", { key: "value" });
    expect(entries[0].context).toEqual({ key: "value" });
  });

  test("includes timestamp in log entry", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger("debug", (e) => entries.push(e));
    logger.info("ts test");
    expect(typeof entries[0].timestamp).toBe("number");
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  test("error level always logs regardless of filter", () => {
    const entries: LogEntry[] = [];
    const logger = new Logger("error", (e) => entries.push(e));
    logger.warn("should not appear");
    logger.error("should appear");
    expect(entries.length).toBe(1);
    expect(entries[0].level).toBe("error");
  });
});
