import { describe, expect, test } from "bun:test";
import { resolveToolOutcome } from "./tool";

describe("resolveToolOutcome", () => {
  test("preserves an explicit framework outcome", () => {
    expect(resolveToolOutcome({
      ok: true,
      outcome: { status: "empty", progress: "none", code: "no_matches" },
    })).toEqual({ status: "empty", progress: "none", code: "no_matches" });
  });

  test("recognizes legacy deferred guard results", () => {
    expect(resolveToolOutcome({ ok: true, data: { status: "deferred" } }))
      .toEqual({ status: "deferred", progress: "none" });
  });

  test("keeps legacy tools compatible without parsing output text", () => {
    expect(resolveToolOutcome({ ok: true })).toEqual({ status: "success", progress: "evidence" });
    expect(resolveToolOutcome({ ok: false })).toEqual({ status: "error", progress: "none" });
  });
});
