import { describe, expect, test } from "bun:test";
import { ToolStatusCollector } from "./tool-result-status";

const status = (content: string) => ({
  content,
  metadata: { ok: true as const, effect: "none" as const },
});

describe("ToolStatusCollector", () => {
  test("keeps per-Tool FIFO order and deletes empty queues", () => {
    const collector = new ToolStatusCollector();
    expect(collector.take("probe")).toBeUndefined();

    collector.push("probe", status("first"));
    collector.push("probe", status("second"));
    expect(collector.peek("probe").map(item => item.content)).toEqual(["first", "second"]);

    expect(collector.take("probe")?.content).toBe("first");
    expect(collector.take("probe")?.content).toBe("second");
    expect(collector.take("probe")).toBeUndefined();
    expect(collector.peek("probe")).toEqual([]);
  });

  test("clears every Tool queue", () => {
    const collector = new ToolStatusCollector();
    collector.push("a", status("a"));
    collector.push("b", status("b"));
    collector.clear();
    expect(collector.peek("a")).toEqual([]);
    expect(collector.peek("b")).toEqual([]);
  });
});
