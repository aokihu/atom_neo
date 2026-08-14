import { describe, expect, test } from "bun:test";
import type { ToolResult } from "./tool";

describe("ToolResult", () => {
  test("keeps model content separate from framework metadata", () => {
    const result: ToolResult = {
      content: "verified fact",
      metadata: { ok: true, effect: "evidence" },
    };
    expect(result.content).toBe("verified fact");
    expect(result.metadata).toEqual({ ok: true, effect: "evidence" });
  });

  test("represents failures without model content", () => {
    const result: ToolResult = {
      metadata: { ok: false, effect: "none", error: "offline", errorSource: "tool" },
    };
    expect(result).toEqual({
      metadata: { ok: false, effect: "none", error: "offline", errorSource: "tool" },
    });
  });
});
