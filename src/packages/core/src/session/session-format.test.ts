import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { SessionMessage, ToolsGroup } from "@atom-neo/shared";
import {
  CHECKPOINT_FILES,
  createMessageManifest,
  parseJsonl,
  parseToolRecordsJsonl,
  sessionDirectoryPath,
  toJsonl,
  toReceipt,
  toSafeSessionId,
  toToolRecordsJsonl,
} from "./session-format";

const messages: SessionMessage[] = [
  { role: "user", content: "first", timestamp: 1, seq: 1, visible: true },
  { role: "assistant", content: "second", timestamp: 2, seq: 2, visible: false },
];

const group: ToolsGroup = {
  id: "tg-00000000-0000-4000-8000-000000000000",
  sessionId: "format",
  taskId: "task",
  topic: "",
  createdAt: 3,
  status: "sealed",
  records: [],
  summary: "",
};

describe("session format", () => {
  test("hashes unsafe session ids and resolves directories", () => {
    expect(toSafeSessionId("layout/unsafe id")).toBe("3aefd158727bdb5a5d12c1e7942b418c");
    expect(sessionDirectoryPath("/sandbox/.atom/sessions", "layout/unsafe id"))
      .toBe(resolve("/sandbox/.atom/sessions", "3aefd158727bdb5a5d12c1e7942b418c"));
    expect(CHECKPOINT_FILES).toEqual(["session.json", "context.json", "message-latest.jsonl", "tool-records.jsonl"]);
  });

  test("round-trips message manifests and messages with a trailing newline", () => {
    const manifest = createMessageManifest("message-000001", messages, { segment: 1, checkpointRevision: undefined });
    const content = toJsonl(manifest, messages);
    expect(content.endsWith("\n")).toBe(true);
    expect(content.trimEnd().split("\n")).toHaveLength(3);
    expect(JSON.stringify(manifest)).toBe(content.split("\n")[0]);

    const parsed = parseJsonl(content);
    expect(parsed.manifest).toEqual(manifest);
    expect(parsed.messages).toEqual(messages);
    expect(parseJsonl("\n\n" + content + "\n\n")).toEqual(parsed);
    expect(parseJsonl('{"type":"unknown"}\n')).toEqual({ manifest: undefined, messages: [] });
  });

  test("round-trips tool record groups and checkpoint revision", () => {
    const content = toToolRecordsJsonl(7, [group]);
    expect(content.endsWith("\n")).toBe(true);
    expect(parseToolRecordsJsonl(content)).toEqual({ checkpointRevision: 7, groups: [group] });
    expect(parseToolRecordsJsonl("\n")).toEqual({ checkpointRevision: undefined, groups: [] });
  });

  test("creates empty manifests and receipts without a segment", () => {
    const manifest = createMessageManifest("message-latest", [], { checkpointRevision: 1 });
    expect(manifest).toMatchObject({ fromSeq: 0, toSeq: 0, count: 0, checkpointRevision: 1 });
    expect(manifest.segment).toBeUndefined();
    expect(toReceipt(manifest)).toEqual({ archiveId: "message-latest", segment: 0, fromSeq: 0, toSeq: 0, count: 0 });
  });
});
