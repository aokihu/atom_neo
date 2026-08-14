import { describe, expect, test } from "bun:test";
import { ToolRecordStore, parseToolRecordId } from "./tool-record-store";

describe("ToolRecordStore", () => {
  test("uses Conversation-local Groups and record Steps", () => {
    const store = new ToolRecordStore();
    const first = store.beginGroup("s1", "conversation-1", "knowledge.weather");
    const success = store.append(first, {
      modelStep: 2,
      batchIndex: 0,
      toolCallId: "call-1",
      toolName: "search_memory",
      source: "builtin",
      startedAt: 10,
      durationMs: 4,
      input: { query: "Hangzhou weather" },
      output: ["sunny", "warm"],
      metadata: { ok: true, effect: "reference" },
    });
    const failure = store.append(first, {
      modelStep: 2,
      batchIndex: 1,
      toolCallId: "call-2",
      toolName: "search_memory",
      source: "builtin",
      startedAt: 20,
      durationMs: 5,
      input: { query: "Ningbo weather" },
      output: "",
      metadata: { ok: false, effect: "none", error: "backend unavailable", errorSource: "tool" },
    });
    store.seal(first);

    expect(success.step).toBe(1);
    expect(failure.step).toBe(2);
    expect(success.modelStep).toBe(2);
    expect(failure.modelStep).toBe(2);
    expect(parseToolRecordId(failure.id)).toEqual({ toolsGroupId: first.id, step: 2 });
    expect(store.getRecord("s1", failure.id)?.metadata).toEqual(failure.metadata);

    const second = store.beginGroup("s1", "conversation-2");
    const reset = store.append(second, {
      modelStep: 0,
      batchIndex: 0,
      toolCallId: "call-3",
      toolName: "weather",
      source: "mcp",
      startedAt: 30,
      durationMs: 6,
      input: { city: "Hangzhou" },
      output: { temperature: 28 },
      metadata: { ok: true, effect: "reference" },
    });

    expect(reset.step).toBe(1);
    expect(reset.toolsGroupId).not.toBe(first.id);
  });

  test("provides bounded summaries, filters, cursors, and interrupted restore", () => {
    const store = new ToolRecordStore();
    const group = store.beginGroup("s1", "conversation-1", "knowledge.weather");
    for (let index = 0; index < 3; index++) {
      store.append(group, {
        modelStep: 1,
        batchIndex: index,
        toolCallId: `call-${index}`,
        toolName: "search_memory",
        source: "builtin",
        startedAt: index,
        durationMs: 1,
        input: { queries: Array.from({ length: 20 }, (_, item) => `query-${item}`) },
        output: Array.from({ length: 20 }, (_, item) => `result-${item}`),
        metadata: { ok: true, effect: "reference" },
      });
    }
    store.seal(group);

    const summary = store.summarize("s1")!;
    expect(summary.groups[0]?.steps).toBe("1..3");
    expect(summary.recentRecords[0]?.input.length).toBeLessThanOrEqual(240);
    expect(summary.recentRecords[0]?.result).toStartWith("list(20)");
    const firstPage = store.query("s1", { toolsGroupId: group.id, limit: 2 });
    expect(firstPage.records.map(record => record.step)).toEqual([1, 2]);
    expect(firstPage.nextCursor).toBe(2);
    expect(store.query("s1", { toolsGroupId: group.id, cursor: 2 }).records.map(record => record.step)).toEqual([3]);

    const active = store.beginGroup("s1", "conversation-2");
    const restored = new ToolRecordStore();
    restored.restoreSession("s1", store.exportSession("s1"));
    expect(restored.exportSession("s1").find(item => item.id === active.id)?.status).toBe("interrupted");
  });
});
