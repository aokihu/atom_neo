import { describe, expect, test } from "bun:test";
import {
  createToolCallFingerprint,
  formatToolGovernanceBlock,
  ToolCallLedger,
} from "./governance";

describe("ToolCallLedger", () => {
  test("creates the same fingerprint for equivalent object key order", () => {
    expect(createToolCallFingerprint("read", { limit: 10, filepath: "a.ts" }))
      .toBe(createToolCallFingerprint("read", { filepath: "a.ts", limit: 10 }));
  });

  test("blocks an exact duplicate until a different call succeeds", () => {
    const ledger = new ToolCallLedger({ maxExecutions: 10 });
    const first = ledger.begin("read", { filepath: "a.ts" });
    expect(first.allowed).toBe(true);
    if (!first.allowed) throw new Error("expected first call to execute");
    ledger.finish(first, true);

    const duplicate = ledger.begin("read", { filepath: "a.ts" });
    expect(duplicate).toMatchObject({ allowed: false, reason: "duplicate_request" });

    const edit = ledger.begin("edit", { filepath: "a.ts", old_string: "a", new_string: "b" });
    expect(edit.allowed).toBe(true);
    if (!edit.allowed) throw new Error("expected edit to execute");
    ledger.finish(edit, true);

    expect(ledger.begin("read", { filepath: "a.ts" }).allowed).toBe(true);
  });

  test("forces a text response after consecutive calls make no progress", () => {
    const ledger = new ToolCallLedger({ maxExecutions: 10, maxConsecutiveNoProgress: 3 });
    for (const toolName of ["one", "two", "three"]) {
      const decision = ledger.begin(toolName, {});
      if (!decision.allowed) throw new Error("expected call to execute");
      ledger.finish(decision, false);
    }

    expect(ledger.shouldForceText()).toBe(true);
    expect(ledger.snapshot()).toMatchObject({
      consecutiveNoProgress: 3,
      stopReason: "consecutive_no_progress",
    });
  });

  test("enters stop state when the execution budget is reached", () => {
    const ledger = new ToolCallLedger({ maxExecutions: 2 });
    const first = ledger.begin("one", {});
    if (!first.allowed) throw new Error("expected first call to execute");
    ledger.finish(first, true);

    const second = ledger.begin("two", {});
    expect(second.allowed).toBe(true);
    expect(ledger.snapshot().stopReason).toBe("tool_call_limit");

    const blocked = ledger.begin("three", {});
    expect(blocked).toMatchObject({ allowed: false, reason: "tool_call_limit" });
  });

  test("returns a compact structured result for blocked calls", () => {
    const ledger = new ToolCallLedger({ maxExecutions: 10 });
    const first = ledger.begin("read", { filepath: "a.ts" });
    if (!first.allowed) throw new Error("expected first call to execute");
    ledger.finish(first, true);
    const duplicate = ledger.begin("read", { filepath: "a.ts" });
    if (duplicate.allowed) throw new Error("expected duplicate to be blocked");

    expect(JSON.parse(formatToolGovernanceBlock(duplicate))).toMatchObject({
      status: "blocked",
      reason: "duplicate_request",
      progress: false,
    });
  });
});
