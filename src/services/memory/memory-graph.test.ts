import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countRelatedMemories, linkMemories, traverseMemories } from "./memory-graph";
import { MemoryStore } from "./memory-store";

const active: Array<{ store: MemoryStore; dir: string }> = [];

function createStore(now = () => 1_700_000_000_000): { store: MemoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "atom-memory-graph-"));
  const store = new MemoryStore({ dbPath: join(dir, "memory.db"), now });
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

describe("memory graph", () => {
  test("orders neighbors by quality and expands at most three per node", () => {
    const { store } = createStore();
    const hub = store.save("graph hub", [], undefined, { baseWeight: 60 });
    const first = store.save("graph first", [], undefined, { baseWeight: 100 });
    const second = store.save("graph second", [], undefined, { baseWeight: 80 });
    const third = store.save("graph third", [], undefined, { baseWeight: 40 });
    const fourth = store.save("graph fourth", [], undefined, { baseWeight: 20 });
    for (const neighbor of [first, second, third, fourth]) {
      expect(linkMemories(store, hub, neighbor, "relates_to")).toBe(true);
    }

    const nodes = traverseMemories(store, hub);

    expect(nodes.map((node) => node.id)).toEqual([hub, first, second, third]);
    expect(nodes.map((node) => node.depth)).toEqual([0, 1, 1, 1]);
  });

  test("stops before visiting nodes at maxSteps", () => {
    const { store } = createStore();
    const hub = store.save("depth hub");
    const near = store.save("depth near");
    const leaf = store.save("depth leaf");
    linkMemories(store, hub, near, "relates_to");
    linkMemories(store, near, leaf, "extends");

    expect(traverseMemories(store, hub, 1).map((node) => node.id)).toEqual([hub]);
    expect(traverseMemories(store, hub, 2).map((node) => node.id)).toEqual([hub, near]);
  });

  test("links idempotently and ignores missing endpoints", () => {
    const { store } = createStore();
    const source = store.save("short edge source");
    const target = store.save("short edge target");

    expect(linkMemories(store, "abcdef", target, "depends_on")).toBe(false);
    expect(linkMemories(store, source.slice(0, 6), target.slice(0, 6), "depends_on")).toBe(true);
    expect(linkMemories(store, source.slice(0, 6), target.slice(0, 6), "depends_on")).toBe(true);
    expect(countRelatedMemories(store, source)).toBe(1);
    expect(traverseMemories(store, source).map((node) => node.id)).toEqual([source, target]);
  });

  test("counts only unexpired related memories", () => {
    let now = 1_000;
    const { store } = createStore(() => now);
    const source = store.save("stable source");
    const target = store.save("temporary target", [], undefined, { ttlSeconds: 60 });
    linkMemories(store, source, target, "relates_to");

    expect(countRelatedMemories(store, source)).toBe(1);
    now = 61_001;
    expect(countRelatedMemories(store, source)).toBe(0);
    expect(traverseMemories(store, source).map((node) => node.id)).toEqual([source]);
  });
});
