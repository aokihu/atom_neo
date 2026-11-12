import { existsSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import type { SqliteDatabase } from "../sqlite-database";

export function initializeMemorySchema(db: SqliteDatabase): boolean {
  db.run(`CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      tags TEXT DEFAULT '',
      weight REAL DEFAULT 100,
      access_count INTEGER DEFAULT 0,
      base_weight REAL DEFAULT 60,
      usage_score REAL DEFAULT 0,
      retrieval_count INTEGER DEFAULT 0,
      read_count INTEGER DEFAULT 0,
      kind TEXT DEFAULT 'stable_fact',
      confidence REAL DEFAULT 1,
      pinned INTEGER DEFAULT 0,
      expires_at INTEGER,
      last_read_at INTEGER,
      last_confirmed_at INTEGER,
      usage_updated_at INTEGER,
      created_at INTEGER,
      accessed_at INTEGER
    )`);
  const nodeColumns = new Set(
    (db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  const addColumn = (name: string, sql: string) => {
    if (nodeColumns.has(name)) return false;
    db.run(`ALTER TABLE nodes ADD COLUMN ${sql}`);
    nodeColumns.add(name);
    return true;
  };
  addColumn("access_count", "access_count INTEGER DEFAULT 0");
  addColumn("content", "content TEXT NOT NULL DEFAULT ''");
  addColumn("summary", "summary TEXT NOT NULL DEFAULT ''");
  const baseWeightAdded = addColumn("base_weight", "base_weight REAL DEFAULT 60");
  const usageScoreAdded = addColumn("usage_score", "usage_score REAL DEFAULT 0");
  addColumn("retrieval_count", "retrieval_count INTEGER DEFAULT 0");
  const readCountAdded = addColumn("read_count", "read_count INTEGER DEFAULT 0");
  addColumn("kind", "kind TEXT DEFAULT 'stable_fact'");
  addColumn("confidence", "confidence REAL DEFAULT 1");
  addColumn("pinned", "pinned INTEGER DEFAULT 0");
  addColumn("expires_at", "expires_at INTEGER");
  const lastReadAdded = addColumn("last_read_at", "last_read_at INTEGER");
  const lastConfirmedAdded = addColumn("last_confirmed_at", "last_confirmed_at INTEGER");
  const usageUpdatedAdded = addColumn("usage_updated_at", "usage_updated_at INTEGER");
  db.run("UPDATE nodes SET summary = content WHERE summary = ''");
  if (baseWeightAdded) db.run("UPDATE nodes SET base_weight = weight");
  if (usageScoreAdded) db.run("UPDATE nodes SET usage_score = MIN(access_count, 4)");
  if (readCountAdded) db.run("UPDATE nodes SET read_count = access_count");
  if (lastReadAdded) db.run("UPDATE nodes SET last_read_at = accessed_at WHERE access_count > 0");
  if (lastConfirmedAdded) db.run("UPDATE nodes SET last_confirmed_at = created_at");
  if (usageUpdatedAdded) db.run("UPDATE nodes SET usage_updated_at = COALESCE(accessed_at, created_at)");

  db.run(`CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL
    )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)");
  db.run(`DELETE FROM edges WHERE id NOT IN (
      SELECT MIN(id) FROM edges GROUP BY source_id, target_id, relation
    )`);
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique ON edges(source_id, target_id, relation)");

  const searchIndexExists = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'",
  ).get());
  const searchIndexColumns = searchIndexExists
    ? db.prepare("PRAGMA table_info(memory_fts)").all() as Array<{ name: string }>
    : [];
  const searchIndexNeedsRebuild = !searchIndexExists || !searchIndexColumns.some((column) => column.name === "summary");
  db.run("DROP TRIGGER IF EXISTS nodes_fts_insert");
  db.run("DROP TRIGGER IF EXISTS nodes_fts_delete");
  db.run("DROP TRIGGER IF EXISTS nodes_fts_update");
  if (searchIndexExists && searchIndexNeedsRebuild) db.run("DROP TABLE memory_fts");
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      summary,
      content,
      tags,
      content='nodes',
      content_rowid='rowid',
      tokenize='trigram'
    )`);
  db.run(`CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes BEGIN
      INSERT INTO memory_fts(rowid, summary, content, tags) VALUES (new.rowid, new.summary, new.content, new.tags);
    END`);
  db.run(`CREATE TRIGGER nodes_fts_delete AFTER DELETE ON nodes BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, summary, content, tags) VALUES ('delete', old.rowid, old.summary, old.content, old.tags);
    END`);
  db.run(`CREATE TRIGGER nodes_fts_update AFTER UPDATE OF summary, content, tags ON nodes BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, summary, content, tags) VALUES ('delete', old.rowid, old.summary, old.content, old.tags);
      INSERT INTO memory_fts(rowid, summary, content, tags) VALUES (new.rowid, new.summary, new.content, new.tags);
    END`);
  return searchIndexNeedsRebuild;
}

export function migrateLegacyContent(db: SqliteDatabase, path?: string): void {
  if (!path || !existsSync(path)) return;

  const migratedFiles: string[] = [];
  const rows: Array<{ id: string; content: string }> = [];
  for (const file of readdirSync(path)) {
    if (!file.endsWith(".txt")) continue;
    const id = file.slice(0, -4);
    if (!db.prepare("SELECT 1 FROM nodes WHERE id = ?").get(id)) continue;
    rows.push({ id, content: readFileSync(`${path}/${file}`, "utf-8") });
    migratedFiles.push(file);
  }

  db.transaction(() => {
    const update = db.prepare("UPDATE nodes SET content = ?, summary = ? WHERE id = ? AND content = ''");
    for (const row of rows) update.run(row.content, row.content, row.id);
  })();
  for (const file of migratedFiles) {
    try { unlinkSync(`${path}/${file}`); } catch { /* content is already authoritative in SQLite */ }
  }
  try { rmdirSync(path); } catch { /* keep unknown legacy files for manual recovery */ }
}
