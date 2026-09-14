import { describe, expect, test } from "bun:test";
import type { ContextFragment } from "@atom-neo/shared";
import { compileContextSnapshot } from "./compiler";
import { contextRows } from "./test-helpers";

type PlannedFragment = ContextFragment;

function instruction(overrides: Partial<PlannedFragment> = {}): PlannedFragment {
  return {
    key: "system", source: "prompt-registry", scope: "system",
    channel: "instructions", trust: "trusted", retention: "pinned",
    priority: 1000, revision: 1, format: "text",
    content: "Follow the user's goal.\nPreserve existing work.",
    ...overrides,
  };
}

function runtime(overrides: Partial<PlannedFragment> = {}): PlannedFragment {
  return {
    key: "state", source: "runtime", scope: "task", channel: "runtime",
    trust: "trusted", retention: "task", priority: 700, revision: 1,
    content: { topic: "cache", status: "pending" },
    ...overrides,
  };
}

function compile(fragments: PlannedFragment[], inputBudget?: number) {
  return compileContextSnapshot(fragments, { inputBudget });
}

function commonPrefix(a: string, b: string): string {
  let end = 0;
  while (end < Math.min(a.length, b.length) && a[end] === b[end]) end++;
  return a.slice(0, end);
}

describe("Context Snapshot cache contract (test-first)", () => {
  test("keeps nested dynamic data structured without encoding it into a string", () => {
    const content = { todos: [{ content: "Check C:\\work", status: "pending", priority: "high" }] };
    const snapshot = compile([runtime({ content, trust: "untrusted" })]).snapshot;
    expect(contextRows(snapshot)[0]).toMatchObject({ trust: "untrusted", content });
  });
  const rules = instruction();
  const workspace = instruction({
    key: "workspace", source: "agents-compiler", scope: "workspace",
    priority: 900, content: "Workspace rules:\nUse small steps.\nDo not overwrite user changes.",
  });
  const stable = [rules, workspace];

  test("renders static instructions as ordinary text without a TOON string wrapper", () => {
    expect(compile([rules]).snapshot.content).toContain(String(rules.content));
  });

  test("keeps the complete static prefix when dynamic entries are added or removed", () => {
    const before = compile([...stable, runtime()]).snapshot.content;
    const after = compile([...stable, runtime(), runtime({
      key: "hint", source: "post-conversation", scope: "step",
      retention: "once", content: "Verify the result",
    })]).snapshot.content;
    const prefix = commonPrefix(before, after);
    expect(prefix).toContain(String(rules.content));
    expect(prefix).toContain(String(workspace.content));
  });

  test("keeps Skill text before higher-priority mutable session data", () => {
    const skill = instruction({ key: "skill", source: "skill-service", scope: "topic",
      retention: "topic", priority: 600, content: "Skill instructions:\nInspect before editing." });
    const data = runtime({ key: "history", scope: "session", priority: 950 });
    const before = compile([...stable, skill, data]).snapshot.content;
    const after = compile([...stable, skill, { ...data, revision: 2,
      content: { topic: "cache", status: "completed" } }]).snapshot.content;
    expect(commonPrefix(before, after)).toContain(String(skill.content));
  });

  test("preserves static text when budget selection removes dynamic entries", () => {
    const entries = [...stable, runtime({ content: "large result ".repeat(100) })];
    const full = compile(entries).snapshot.content;
    const limited = compile(entries, 1);
    expect(limited.manifest.find(item => item.key === "state")?.reason).toBe("budget");
    expect(commonPrefix(full, limited.snapshot.content)).toContain(String(workspace.content));
  });

  test.each([
    { trust: "untrusted" as const, channel: "messages" as const },
    { channel: "runtime" as const },
    { content: { rule: "structured data" } },
  ])("rejects text format outside trusted string instructions: %j", overrides => {
    expect(() => compile([instruction(overrides)])).toThrow();
  });

  test("preserves literal paths and repairs Unicode in ordinary text", () => {
    const content = String.raw`Read C:\users\alice; preserve literal \u1234` + "\nBroken: \uD800";
    const output = compile([instruction({ content })]).snapshot.content;
    expect(output).toContain(content.toWellFormed());
    expect(output.isWellFormed()).toBe(true);
  });

  test("produces identical content for equivalent producer insertion orders", () => {
    const entries = [...stable, runtime()];
    expect(compile(entries).snapshot.content).toBe(compile([...entries].reverse()).snapshot.content);
  });

  test("does not expose Snapshot IDs or entry revisions in model content", () => {
    const first = compile([...stable, runtime()]);
    const next = compile([...stable, runtime({ revision: 99 })]);
    expect(first.snapshot.id).not.toBe(next.snapshot.id);
    expect(first.snapshot.content).toBe(next.snapshot.content);
    expect(first.snapshot.content).not.toContain(first.snapshot.id);
  });

  test("keeps receipt selection independent from output format", () => {
    const selected = runtime({ key: "once", retention: "once", content: "hint" });
    const dropped = runtime({ key: "dropped", retention: "once", priority: 0,
      content: "large ".repeat(100) });
    const result = compile([selected, dropped], 1);
    expect(result.receipts.map(receipt => receipt.fragmentKey)).toEqual(["once"]);
    expect(result.manifest.find(item => item.key === "dropped")?.reason).toBe("budget");
  });
});
