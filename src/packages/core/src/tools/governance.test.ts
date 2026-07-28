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
    ledger.finish(first, "evidence");

    const duplicate = ledger.begin("read", { filepath: "a.ts" });
    expect(duplicate).toMatchObject({ allowed: false, reason: "duplicate_request" });

    const edit = ledger.begin("edit", { filepath: "a.ts", old_string: "a", new_string: "b" });
    expect(edit.allowed).toBe(true);
    if (!edit.allowed) throw new Error("expected edit to execute");
    ledger.finish(edit, "state_changed");

    expect(ledger.begin("read", { filepath: "a.ts" }).allowed).toBe(true);
  });

  test("tracks consecutive no-progress calls without stopping the model", () => {
    const ledger = new ToolCallLedger({ maxExecutions: 10, maxConsecutiveNoProgress: 3 });
    for (const toolName of ["one", "two", "three"]) {
      const decision = ledger.begin(toolName, {});
      if (!decision.allowed) throw new Error("expected call to execute");
      ledger.finish(decision, "none");
    }

    expect(ledger.shouldForceText()).toBe(false);
    expect(ledger.snapshot()).toMatchObject({
      consecutiveNoProgress: 3,
    });
    expect(ledger.snapshot().stopReason).toBeUndefined();
  });

  test("allows materially different queries after empty search results", () => {
    const ledger = new ToolCallLedger({ maxExecutions: 10, maxConsecutiveNoProgress: 3 });
    for (const query of ["浙江大学 游泳馆", "ZJU swimming pool", "浙江大学 体育设施"]) {
      const decision = ledger.begin("search_memory", { query });
      expect(decision.allowed).toBe(true);
      if (!decision.allowed) throw new Error("expected a distinct query to execute");
      ledger.finish(decision, "none");
    }

    expect(ledger.shouldForceText()).toBe(false);
    expect(ledger.snapshot()).toMatchObject({
      executions: 3,
      consecutiveNoProgress: 3,
    });
  });

  test("enters stop state when the execution budget is reached", () => {
    const ledger = new ToolCallLedger({ maxExecutions: 2 });
    const first = ledger.begin("one", {});
    if (!first.allowed) throw new Error("expected first call to execute");
    ledger.finish(first, "evidence");

    const second = ledger.begin("two", {});
    expect(second.allowed).toBe(true);
    expect(ledger.snapshot().stopReason).toBe("tool_call_limit");

    const blocked = ledger.begin("three", {});
    expect(blocked).toMatchObject({ allowed: false, reason: "tool_call_limit" });
  });

  test("clears the no-progress counter when a Tool produces useful progress", () => {
    const ledger = new ToolCallLedger({ maxExecutions: 10, maxConsecutiveNoProgress: 2 });
    for (const toolName of ["search_memory", "skill_list"]) {
      const decision = ledger.begin(toolName, {});
      if (!decision.allowed) throw new Error("expected call to execute");
      ledger.finish(decision, "none");
    }

    expect(ledger.snapshot().consecutiveNoProgress).toBe(2);
    const webfetch = ledger.begin("webfetch", { url: "https://example.com" });
    if (!webfetch.allowed) throw new Error("expected webfetch to execute");
    const snapshot = ledger.finish(webfetch, "evidence");
    expect(snapshot.consecutiveNoProgress).toBe(0);
    expect(snapshot.stopReason).toBeUndefined();
    expect(ledger.begin("read", { filepath: "result.txt" }).allowed).toBe(true);
  });

  test("returns only the instruction needed by the model for blocked calls", () => {
    const ledger = new ToolCallLedger({ maxExecutions: 10 });
    const first = ledger.begin("read", { filepath: "a.ts" });
    if (!first.allowed) throw new Error("expected first call to execute");
    ledger.finish(first, "evidence");
    const duplicate = ledger.begin("read", { filepath: "a.ts" });
    if (duplicate.allowed) throw new Error("expected duplicate to be blocked");

    expect(formatToolGovernanceBlock(duplicate)).toBe(
      "Do not repeat this tool call unless another successful action changes its inputs or underlying state.",
    );
  });
});
