import { describe, expect, test } from "bun:test";
import type { Message } from "../../types";
import {
  SIDEBAR_CONTENT_WIDTH,
  buildGauge,
  pct,
  summarizeNetwork,
  summarizeTools,
  toolEntries,
  toolState,
} from "./sidebar-metrics";

const messages: Message[] = [
  { role: "user", content: "go", id: "u", timestamp: 1 },
  {
    role: "tool-group",
    id: "one",
    timestamp: 2,
    collapsed: false,
    entries: [
      { toolCallId: "a", toolName: "read", phase: "done" },
      { toolCallId: "b", toolName: "WebFetch", phase: "preparing" },
    ],
  },
  {
    role: "tool-group",
    id: "two",
    timestamp: 3,
    collapsed: false,
    entries: [
      { toolCallId: "c", toolName: "webfetch", phase: "error" },
      { toolCallId: "d", toolName: "shell", phase: "executing" },
      { toolCallId: "e", toolName: "webfetch", phase: "done" },
    ],
  },
];

describe("sidebar gauges", () => {
  test("builds fixed-width gauges and clamps the ratio", () => {
    expect(buildGauge(0, 100, SIDEBAR_CONTENT_WIDTH)).toBe("░".repeat(SIDEBAR_CONTENT_WIDTH));
    expect(buildGauge(100, 100, SIDEBAR_CONTENT_WIDTH)).toBe("█".repeat(SIDEBAR_CONTENT_WIDTH));
    expect(buildGauge(100, 0, 10)).toBe("█".repeat(10));
    expect(buildGauge(50, 100, 10)).toBe("█████░░░░░");
  });

  test("rounds context percentages with a safe limit", () => {
    expect(pct(5_000, 10_000)).toBe("50%");
    expect(pct(1, 0)).toBe("100%");
  });
});

describe("tool telemetry", () => {
  test("flattens tool groups and maps phases to states", () => {
    expect(toolEntries(messages).map(entry => entry.toolCallId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(toolState("preparing")).toBe("RUN");
    expect(toolState("executing")).toBe("RUN");
    expect(toolState("done")).toBe("OK");
    expect(toolState("error")).toBe("ERR");
  });

  test("counts running, builtin and MCP tools", () => {
    const summary = summarizeTools(messages, [
      { name: "read", source: "builtin" },
      { name: "shell", source: "builtin" },
      { name: "remote", source: "mcp" },
      { name: "plugin", source: "plugin" },
    ]);
    expect(summary.entries).toHaveLength(5);
    expect(summary.running).toBe(2);
    expect(summary.builtin).toBe(2);
    expect(summary.mcp).toBe(1);
  });

  test("counts webfetch outcomes case-insensitively", () => {
    expect(summarizeNetwork(messages)).toEqual({ fetched: 3, success: 1, failed: 1 });
    expect(summarizeNetwork([])).toEqual({ fetched: 0, success: 0, failed: 0 });
  });
});
