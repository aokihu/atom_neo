import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryService } from "./memory-service";
import { SqliteDatabase } from "./sqlite-database";

const activeServices: MemoryService[] = [];

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function createMemoryService(): Promise<{ service: MemoryService; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "atom-memory-characterization-"));
  const service = new MemoryService({
    dbPath: join(dir, "memory.db"),
    legacyNodesPath: join(dir, "nodes"),
    now: () => 1_700_000_000_000,
  });
  activeServices.push(service);
  await service.start();
  return { service, dir };
}

afterEach(async () => {
  for (const service of activeServices.splice(0)) await service.stop();
});

describe("MemoryService characterization", () => {
  test("keeps the SQLite schema, index, trigger and FTS shape stable", async () => {
    const { service, dir } = await createMemoryService();
    try {
      const db = new SqliteDatabase(join(dir, "memory.db"));
      const schema = db.prepare(
        `SELECT type, name, sql FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'memory_fts_%'
         ORDER BY type, name`,
      ).all();
      const ftsColumns = db.prepare("PRAGMA table_info(memory_fts)").all() as Array<{ name: string }>;
      db.close();

      expect(schema).toEqual([
        {
          type: "index",
          name: "idx_edges_source",
          sql: "CREATE INDEX idx_edges_source ON edges(source_id)",
        },
        {
          type: "index",
          name: "idx_edges_target",
          sql: "CREATE INDEX idx_edges_target ON edges(target_id)",
        },
        {
          type: "index",
          name: "idx_edges_unique",
          sql: "CREATE UNIQUE INDEX idx_edges_unique ON edges(source_id, target_id, relation)",
        },
        {
          type: "table",
          name: "edges",
          sql: "CREATE TABLE edges (\n      id INTEGER PRIMARY KEY AUTOINCREMENT,\n      source_id TEXT NOT NULL,\n      target_id TEXT NOT NULL,\n      relation TEXT NOT NULL\n    )",
        },
        {
          type: "table",
          name: "memory_fts",
          sql: "CREATE VIRTUAL TABLE memory_fts USING fts5(\n      summary,\n      content,\n      tags,\n      content='nodes',\n      content_rowid='rowid',\n      tokenize='trigram'\n    )",
        },
        {
          type: "table",
          name: "nodes",
          sql: "CREATE TABLE nodes (\n      id TEXT PRIMARY KEY,\n      content TEXT NOT NULL DEFAULT '',\n      summary TEXT NOT NULL DEFAULT '',\n      tags TEXT DEFAULT '',\n      weight REAL DEFAULT 100,\n      access_count INTEGER DEFAULT 0,\n      base_weight REAL DEFAULT 60,\n      usage_score REAL DEFAULT 0,\n      retrieval_count INTEGER DEFAULT 0,\n      read_count INTEGER DEFAULT 0,\n      kind TEXT DEFAULT 'stable_fact',\n      confidence REAL DEFAULT 1,\n      pinned INTEGER DEFAULT 0,\n      expires_at INTEGER,\n      last_read_at INTEGER,\n      last_confirmed_at INTEGER,\n      usage_updated_at INTEGER,\n      created_at INTEGER,\n      accessed_at INTEGER\n    )",
        },
        {
          type: "trigger",
          name: "nodes_fts_delete",
          sql: "CREATE TRIGGER nodes_fts_delete AFTER DELETE ON nodes BEGIN\n      INSERT INTO memory_fts(memory_fts, rowid, summary, content, tags) VALUES ('delete', old.rowid, old.summary, old.content, old.tags);\n    END",
        },
        {
          type: "trigger",
          name: "nodes_fts_insert",
          sql: "CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes BEGIN\n      INSERT INTO memory_fts(rowid, summary, content, tags) VALUES (new.rowid, new.summary, new.content, new.tags);\n    END",
        },
        {
          type: "trigger",
          name: "nodes_fts_update",
          sql: "CREATE TRIGGER nodes_fts_update AFTER UPDATE OF summary, content, tags ON nodes BEGIN\n      INSERT INTO memory_fts(memory_fts, rowid, summary, content, tags) VALUES ('delete', old.rowid, old.summary, old.content, old.tags);\n      INSERT INTO memory_fts(rowid, summary, content, tags) VALUES (new.rowid, new.summary, new.content, new.tags);\n    END",
        },
      ]);
      expect(ftsColumns.map((column) => column.name)).toEqual(["summary", "content", "tags"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("keeps search result order and content-hash node IDs stable", async () => {
    const { service, dir } = await createMemoryService();
    try {
      const alpha = hash("alpha bravo charlie");
      const delta = hash("alpha delta echo");
      const bravo = hash("bravo foxtrot");

      const savedAlpha = service.save("alpha bravo charlie", ["shared", "alpha"], "alpha bravo summary", { baseWeight: 60 });
      const savedDelta = service.save("alpha delta echo", ["shared"], undefined, { baseWeight: 90, pinned: true });
      const savedBravo = service.save("bravo foxtrot", ["alpha"], undefined, { baseWeight: 40 });
      service.save("unrelated golf", ["misc"], undefined, { baseWeight: 100 });

      expect([savedAlpha, savedDelta, savedBravo]).toEqual([alpha, delta, bravo]);
      expect((await service.search("alpha bravo", 3)).map((node) => node.id)).toEqual([alpha, bravo, delta]);
      expect((await service.search("al", 3)).map((node) => node.id)).toEqual([alpha, delta, bravo]);
      expect(await service.search("   ", 3)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("keeps graph BFS order, relations and depths stable", async () => {
    const { service, dir } = await createMemoryService();
    try {
      const hub = hash("graph hub");
      const near = hash("graph near");
      const far = hash("graph far");
      const leaf = hash("graph leaf");

      service.save("graph hub", [], undefined, { baseWeight: 60 });
      service.save("graph near", [], undefined, { baseWeight: 90 });
      service.save("graph far", [], undefined, { baseWeight: 30 });
      service.save("graph leaf", [], undefined, { baseWeight: 70 });
      service.link(hub, near, "depends_on");
      service.link(hub, far, "relates_to");
      service.link(near, leaf, "extends");

      expect(service.traverse(hub).map(({ id, sourceId, relation, direction, depth }) => ({
        id, sourceId, relation, direction, depth,
      }))).toEqual([
        { id: hub, sourceId: null, relation: null, direction: null, depth: 0 },
        { id: near, sourceId: hub, relation: "depends_on", direction: "outgoing", depth: 1 },
        { id: far, sourceId: hub, relation: "relates_to", direction: "outgoing", depth: 1 },
        { id: leaf, sourceId: near, relation: "extends", direction: "outgoing", depth: 2 },
      ]);

      expect(service.traverse(near).map(({ id, sourceId, relation, direction, depth }) => ({
        id, sourceId, relation, direction, depth,
      }))).toEqual([
        { id: near, sourceId: null, relation: null, direction: null, depth: 0 },
        { id: leaf, sourceId: near, relation: "extends", direction: "outgoing", depth: 1 },
        { id: hub, sourceId: near, relation: "depends_on", direction: "incoming", depth: 1 },
        { id: far, sourceId: hub, relation: "relates_to", direction: "outgoing", depth: 2 },
      ]);
      expect(service.countRelated(hub)).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
