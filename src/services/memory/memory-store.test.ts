import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./memory-store";

const active: Array<{ store: MemoryStore; dir: string }> = [];

function createStore(now = () => 1_700_000_000_000): { store: MemoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "atom-memory-store-"));
  const store = new MemoryStore({ dbPath: join(dir, "memory.db"), now });
  active.push({ store, dir });
  return { store, dir };
}

afterEach(() => {
  for (const { store, dir } of active.splice(0)) {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("MemoryStore", () => {
  test("owns database lifecycle and reports a closed store", () => {
    const { store } = createStore();

    expect(store.isOpen).toBe(false);
    expect(() => store.loadNode("abcdef")).toThrow("MemoryService is not started");

    store.open();
    expect(store.isOpen).toBe(true);

    store.close();
    store.close();
    expect(store.isOpen).toBe(false);
    expect(() => store.all("SELECT 1")).toThrow("MemoryService is not started");
  });

  test("maps rows and keeps FTS usable after reopen", () => {
    const now = 1_700_000_000_000;
    const { store } = createStore(() => now);
    store.open();

    const id = store.save("store mapped memory", ["one", "two"], "compact", {
      baseWeight: 75,
      kind: "preference",
      confidence: 0.5,
      pinned: true,
      ttlSeconds: 60,
    });

    expect(id).toBe(createHash("sha256").update("store mapped memory").digest("hex"));
    expect(store.getById(id.slice(0, 6))).toEqual({
      id,
      content: "store mapped memory",
      summary: "compact",
      tags: ["one", "two"],
      baseWeight: 75,
      usageScore: 0,
      retrievalCount: 0,
      readCount: 0,
      kind: "preference",
      confidence: 0.5,
      pinned: true,
      expiresAt: now + 60_000,
      lastReadAt: null,
      lastConfirmedAt: now,
      usageUpdatedAt: now,
      createdAt: now,
      accessedAt: now,
    });

    store.recordRetrievals([id, id]);
    expect(store.loadNode(id)?.retrievalCount).toBe(1);

    store.close();
    store.open();
    expect(store.loadNode(id)?.retrievalCount).toBe(1);
    expect(store.all<{ id: string }>(
      `SELECT nodes.id FROM memory_fts JOIN nodes ON nodes.rowid = memory_fts.rowid
       WHERE memory_fts MATCH ?`,
      ["mapped"],
    )).toEqual([{ id }]);
  });
});
