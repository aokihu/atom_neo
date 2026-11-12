import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchMemories } from "./memory-query";
import { MemoryStore } from "./memory-store";

const active: Array<{ store: MemoryStore; dir: string }> = [];

function createStore(): { store: MemoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "atom-memory-query-"));
  const store = new MemoryStore({ dbPath: join(dir, "memory.db"), now: () => 1_700_000_000_000 });
  active.push({ store, dir });
  store.open();
  return { store, dir };
}

afterEach(() => {
  for (const { store, dir } of active.splice(0)) {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("searchMemories", () => {
  test("matches long and short terms and records retrievals", async () => {
    const { store } = createStore();
    const long = store.save("typhoon workflow reference", ["skill"]);
    const short = store.save("ab", ["short"]);

    expect((await searchMemories(store, "typhoon", 5)).map((node) => node.id)).toEqual([long]);
    expect(store.loadNode(long)?.retrievalCount).toBe(1);
    expect((await searchMemories(store, "ab", 5)).map((node) => node.id)).toEqual([short]);
  });

  test("filters candidates by kind and applies the requested limit", async () => {
    const { store } = createStore();
    const preference = store.save("deployment preference blue", ["ops"], undefined, { kind: "preference" });
    store.save("deployment decision green", ["ops"], undefined, { kind: "decision" });

    expect((await searchMemories(store, "deployment", 5, "preference")).map((node) => node.id))
      .toEqual([preference]);
    expect(await searchMemories(store, "deployment", 1)).toHaveLength(1);
  });

  test("returns nothing for blank queries and excludes superseded memories", async () => {
    const { store } = createStore();
    const old = store.save("shared topic alpha");
    const replacement = store.save("shared topic beta", [], undefined, { supersedesId: old });

    expect(await searchMemories(store, "   ", 5)).toEqual([]);
    expect(await searchMemories(store, "missingtoken", 5)).toEqual([]);
    expect((await searchMemories(store, "shared topic", 5)).map((node) => node.id)).toEqual([replacement]);
  });
});
