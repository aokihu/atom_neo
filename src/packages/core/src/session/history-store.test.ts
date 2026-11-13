import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SessionMessage } from "@atom-neo/shared";
import { CheckpointStore } from "./checkpoint-store";
import { HistoryStore } from "./history-store";

const roots: string[] = [];

const createStore = () => {
  const root = mkdtempSync(resolve(tmpdir(), "atom-history-store-"));
  roots.push(root);
  const checkpoints = new CheckpointStore(resolve(root, ".atom", "sessions"));
  return { root, checkpoints, history: new HistoryStore(checkpoints) };
};

const messages = (count: number, content = (index: number) => `needle message ${index}`): SessionMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: content(index),
    timestamp: index + 1,
    seq: index + 1,
    visible: true,
  }));

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("HistoryStore", () => {
  test("archives immutable segments, deduplicates ranges, and reports the index", () => {
    const { history } = createStore();
    const all = messages(3);
    expect(history.archiveMessages("session", [])).toBeNull();
    expect(() => history.archiveMessages("session", [{ role: "user", content: "no seq", timestamp: 1 }]))
      .toThrow("Cannot archive messages without seq");

    const first = history.archiveMessages("session", all.slice(0, 2))!;
    expect(first).toEqual({ archiveId: "message-000001", segment: 1, fromSeq: 1, toSeq: 2, count: 2 });
    expect(history.archiveMessages("session", all.slice(0, 2))).toEqual(first);
    const second = history.archiveMessages("session", all.slice(2))!;
    expect(second).toEqual({ archiveId: "message-000002", segment: 2, fromSeq: 3, toSeq: 3, count: 1 });

    expect(history.inspectArchives("session", 4)).toEqual({
      segmentCount: 2,
      archivedMessageCount: 3,
      latestMessageCount: 4,
      nextSegment: 3,
    });
    expect(history.getArchiveIndex("session")).toEqual({
      segmentCount: 2,
      messageCount: 3,
      fromSeq: 1,
      toSeq: 3,
      latestArchiveId: "message-000002",
      retrieval: "Use search_history, then read_history, to verify original conversation messages.",
    });
    expect(history.getArchiveIndex("missing")).toMatchObject({ segmentCount: 0, messageCount: 0 });
  });

  test("caps search at 20 and read at 51 while filtering visible messages and roles", () => {
    const { history } = createStore();
    const all = messages(60);
    all[1] = { ...all[1]!, visible: false };
    all[2] = { ...all[2]!, role: "system" as never };
    history.archiveMessages("session", all);

    expect(history.searchHistory("session", { query: "  NEEDLE " })).toHaveLength(5);
    expect(history.searchHistory("session", { query: "needle", limit: 100 })).toHaveLength(20);
    expect(history.searchHistory("session", { query: "needle", limit: 0 })).toHaveLength(1);
    expect(history.searchHistory("session", { query: "   " })).toEqual([]);
    expect(history.searchHistory("session", { query: "needle", role: "assistant", limit: 100 }))
      .toHaveLength(20);
    expect(history.searchHistory("session", { query: "message 2", limit: 100 })
      .every(match => match.seq !== 2 && match.seq !== 3)).toBe(true);

    expect(history.readHistory("session", { archiveId: "message-000001" })).toHaveLength(20);
    expect(history.readHistory("session", { archiveId: "message-000001", limit: 100 })).toHaveLength(51);
    expect(history.readHistory("session", { archiveId: "message-000001", fromSeq: 4, toSeq: 5, limit: 100 }))
      .toEqual([
        { archiveId: "message-000001", seq: 4, role: "assistant", timestamp: 4, content: "needle message 3" },
        { archiveId: "message-000001", seq: 5, role: "user", timestamp: 5, content: "needle message 4" },
      ]);
  });

  test("rejects invalid archive ids and ranges", () => {
    const { history } = createStore();
    expect(() => history.readHistory("session", { archiveId: "message-1" })).toThrow("Invalid archiveId");
    expect(() => history.getHistoryArchiveRevision("session", "../session")).toThrow("Invalid archiveId");
    expect(() => history.readHistory("session", { archiveId: "message-000001", fromSeq: 2, toSeq: 1 }))
      .toThrow("Invalid history range");
    expect(history.getHistoryArchiveRevision("session", "message-000001")).toBeUndefined();
    expect(history.readHistory("session", { archiveId: "message-latest" })).toEqual([]);
  });

  test("reads message-latest through the current generation and deduplicates by seq", () => {
    const { checkpoints, history } = createStore();
    const dir = checkpoints.getSessionDirectory("session");
    const manifest = { type: "manifest", schemaVersion: 1, archiveId: "message-latest", checkpointRevision: 3, fromSeq: 1, toSeq: 2, count: 2, createdAt: 1 };
    checkpoints.commit(dir, 3, {
      "session.json": JSON.stringify({ schemaVersion: 1, checkpointRevision: 3 }),
      "context.json": "{}\n",
      "message-latest.jsonl": [
        JSON.stringify(manifest),
        JSON.stringify({ type: "message", role: "user", content: "latest needle", timestamp: 2, seq: 2, visible: true }),
        JSON.stringify({ type: "message", role: "assistant", content: "latest answer", timestamp: 3, seq: 3, visible: true }),
      ].join("\n") + "\n",
      "tool-records.jsonl": "{}\n",
    });
    history.archiveMessages("session", [
      { role: "user", content: "latest needle", timestamp: 1, seq: 1, visible: true },
      { role: "assistant", content: "archived answer", timestamp: 2, seq: 2, visible: true },
    ]);

    expect(history.getHistoryArchiveRevision("session", "message-latest")).toBe(3);
    expect(history.readHistory("session", { archiveId: "message-latest" }).map(match => match.seq)).toEqual([2, 3]);
    expect(history.searchHistory("session", { query: "needle" }).map(match => [match.archiveId, match.seq])).toEqual([
      ["message-000001", 1],
      ["message-latest", 2],
    ]);
  });

  test("removes a partially written archive when verification fails", () => {
    const { checkpoints, history } = createStore();
    const sparse = new Array<SessionMessage>(2);
    sparse[0] = { role: "user", content: "only one", timestamp: 1, seq: 1, visible: true };
    expect(() => history.archiveMessages("session", sparse)).toThrow("Archive verification failed: expected 2, got 1");
    const dir = checkpoints.getSessionDirectory("session", false);
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir).filter(name => name.startsWith("message-"))).toEqual([]);
  });
});
