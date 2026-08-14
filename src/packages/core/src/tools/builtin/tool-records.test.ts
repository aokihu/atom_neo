import { describe, expect, test } from "bun:test";
import { ToolRecordStore } from "../tool-record-store";
import { createToolRecordTools } from "./tool-records";

function setup() {
  const store = new ToolRecordStore();
  const group = store.beginGroup("s1", "conversation-1");
  const records = ["Hangzhou", "Ningbo"].map((city, batchIndex) => store.append(group, {
    modelStep: 1,
    batchIndex,
    toolCallId: `call-${batchIndex}`,
    toolName: "weather",
    source: "mcp",
    startedAt: batchIndex,
    durationMs: 2,
    input: { city },
    output: { city, temperature: 28 + batchIndex },
    metadata: { ok: true, effect: "reference" },
  }));
  store.seal(group);
  const tools = createToolRecordTools(store);
  return {
    group,
    records,
    one: tools.find(tool => tool.name === "request_tool_record")!,
    many: tools.find(tool => tool.name === "request_tool_records")!,
  };
}

describe("ToolRecord query tools", () => {
  test("reads one record only from the current Session", async () => {
    const { records, one } = setup();
    const result = await one.execute({ recordId: records[0]!.id }, { sessionId: "s1" });
    const other = await one.execute({ recordId: records[0]!.id }, { sessionId: "s2" });

    expect(one.recordPolicy).toBe("exclude");
    expect(one.allowSameToolBatch).toBe(true);
    expect(result.metadata).toEqual({ ok: true, effect: "reference" });
    expect((result.content as any).input).toEqual({ city: "Hangzhou" });
    expect(other.metadata).toMatchObject({ ok: false, errorSource: "tool" });
  });

  test("reads a bounded Group range with cursor metadata", async () => {
    const { group, many } = setup();
    const first = await many.execute({ toolsGroupId: group.id, fromStep: 1, toStep: 2, limit: 1 }, { sessionId: "s1" });
    const empty = await many.execute({ toolsGroupId: group.id, fromStep: 3 }, { sessionId: "s1" });

    expect(many.recordPolicy).toBe("exclude");
    expect(many.allowSameToolBatch).toBe(true);
    expect((first.content as any).records).toHaveLength(1);
    expect((first.content as any).nextCursor).toBe(1);
    expect(empty).toEqual({ metadata: { ok: true, effect: "none" } });
  });

  test("rejects malformed IDs and reversed Step ranges", async () => {
    const { group, one, many } = setup();
    const invalidId = await one.execute({ recordId: "group-1" }, { sessionId: "s1" });
    const reversed = await many.execute({ toolsGroupId: group.id, fromStep: 2, toStep: 1 }, { sessionId: "s1" });

    expect(invalidId.metadata).toMatchObject({ ok: false, errorSource: "tool" });
    expect(reversed.metadata).toMatchObject({ ok: false, errorSource: "tool" });
  });
});
