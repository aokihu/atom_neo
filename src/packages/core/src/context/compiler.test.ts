import { describe, expect, test } from "bun:test";
import { decode } from "@toon-format/toon";
import type { ContextFragment } from "@atom-neo/shared";
import type { ContextSnapshot } from "@atom-neo/shared";
import { compileContextSnapshot } from "./compiler";

function fragment(overrides: Partial<ContextFragment>): ContextFragment {
  return {
    key: "default",
    source: "test",
    scope: "session",
    channel: "instructions",
    retention: "session",
    priority: 0,
    revision: 1,
    content: "value",
    ...overrides,
  };
}

function rows(snapshot: ContextSnapshot): Array<Record<string, unknown>> {
  return (decode(snapshot.content) as { context: Array<Record<string, unknown>> }).context;
}

describe("compileContextSnapshot", () => {
  test("orders instructions by scope and priority", () => {
    const { snapshot } = compileContextSnapshot([
      fragment({ key: "task", scope: "task", content: "task" }),
      fragment({ key: "system-low", scope: "system", priority: 1, content: "system-low" }),
      fragment({ key: "system-high", scope: "system", priority: 10, content: "system-high" }),
    ], { id: "s1" });

    expect(rows(snapshot).map(row => row.content)).toEqual(["system-high", "system-low", "task"]);
    expect(snapshot.id).toBe("s1");
  });

  test("keeps the newest duplicate revision", () => {
    const compilation = compileContextSnapshot([
      fragment({ key: "same", revision: 1, content: "old" }),
      fragment({ key: "same", revision: 2, content: "new" }),
    ]);

    expect(rows(compilation.snapshot).map(row => row.content)).toEqual(["new"]);
    expect(compilation.manifest.find(item => item.reason === "duplicate")?.revision).toBe(1);
  });

  test("keeps pinned fragments and drops optional fragments over budget", () => {
    const compilation = compileContextSnapshot([
      fragment({ key: "pinned", scope: "system", retention: "pinned", content: "always" }),
      fragment({ key: "optional", content: "x".repeat(100) }),
    ], { inputBudget: 1 });

    expect(rows(compilation.snapshot).map(row => row.content)).toEqual(["always"]);
    expect(compilation.manifest.find(item => item.key === "optional")?.reason).toBe("budget");
  });

  test("creates receipts only for selected once fragments", () => {
    const compilation = compileContextSnapshot([
      fragment({ key: "hint", retention: "once", content: "retry hint", receiptId: "hint:1" }),
    ]);

    expect(compilation.receipts).toEqual([{
      id: "hint:1",
      fragmentKey: "hint",
      source: "test",
      revision: 1,
    }]);
  });

  test("keeps attached receipts tied to the selected fragment", () => {
    const receipt = { id: "hint:1", fragmentKey: "hint", source: "session", revision: 3 };
    const compilation = compileContextSnapshot([
      fragment({ key: "hint", retention: "once", revision: 3, content: "retry hint", receipts: [receipt] }),
    ]);

    expect(compilation.receipts).toEqual([receipt]);
    expect(compilation.prefixHash).toHaveLength(16);
    expect(compilation.inputBudget).toBe(compilation.estimatedTokens);
  });

  test("selects higher-priority task context before lower-priority history", () => {
    const compilation = compileContextSnapshot([
      fragment({ key: "history", scope: "session", priority: 1, content: "x".repeat(40) }),
      fragment({ key: "task", scope: "task", priority: 100, content: "task" }),
    ], { inputBudget: 1 });

    expect(rows(compilation.snapshot).map(row => row.content)).toEqual(["task"]);
    expect(compilation.manifest.find(item => item.key === "history")?.reason).toBe("budget");
  });

  test("freezes the snapshot and nested collections", () => {
    const runtime = { nested: { value: 1 } };
    const compilation = compileContextSnapshot([
      fragment({ key: "messages", channel: "messages", content: [{ role: "user", content: "hello" }] }),
      fragment({ key: "runtime", channel: "runtime", content: runtime }),
    ]);

    expect(Object.isFrozen(compilation)).toBe(true);
    expect(Object.isFrozen(compilation.snapshot)).toBe(true);
    expect(Object.isFrozen(compilation.manifest)).toBe(true);
    expect(rows(compilation.snapshot).map(row => row.content)).toEqual([
      "hello",
      "nested:\n  value: 1",
    ]);
    expect(Object.isFrozen(runtime.nested)).toBe(false);
  });

  test("rejects untrusted instructions", () => {
    expect(() => compileContextSnapshot([
      fragment({ key: "unsafe", trust: "untrusted" }),
    ])).toThrow("Untrusted context cannot use the instructions channel");
  });

  test("encodes message fragments as TOON context rows", () => {
    const { snapshot } = compileContextSnapshot([
      fragment({ key: "current", scope: "task", channel: "messages", priority: 1000, content: [{ role: "user", content: "current" }] }),
      fragment({ key: "memory", scope: "task", channel: "messages", priority: 650, content: [{ role: "assistant", content: "memory" }] }),
    ]);

    expect(rows(snapshot)).toEqual([
      { trust: "trusted", scope: "task", channel: "messages", source: "test", content: "current" },
      { trust: "trusted", scope: "task", channel: "messages", source: "test", content: "memory" },
    ]);
  });

  test("repairs lone surrogates before TOON encoding", () => {
    const { snapshot } = compileContextSnapshot([
      fragment({ key: "text", content: "broken \uD800 text" }),
      fragment({ key: "runtime", channel: "runtime", content: { nested: "broken \uDFFF text" } }),
    ]);
    const [runtime, text] = rows(snapshot);

    expect(snapshot.content.isWellFormed()).toBe(true);
    expect(text?.content).toBe("broken � text");
    expect(decode(String(runtime?.content))).toEqual({ nested: "broken � text" });
  });

  test("preserves literal escapes and paths", () => {
    const content = String.raw`Windows C:\users\alice; regex /\u4e00-\u9fff/; literal \u12`;
    const { snapshot } = compileContextSnapshot([fragment({ content })]);

    expect(rows(snapshot)[0]?.content).toBe(content);
  });
});
