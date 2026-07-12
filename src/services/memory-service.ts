import { BaseService } from "./base-service";
import { parseMemorySearchTerms } from "@atom-neo/shared";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";

export type MemoryNode = {
  id: string;
  content: string;
  tags: string[];
  weight: number;
  accessCount: number;
  createdAt: number;
  accessedAt: number;
};

export class MemoryService extends BaseService {
  readonly name = "memory";

  #db: Database;
  #legacyNodesPath?: string;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(params: { dbPath: string; legacyNodesPath?: string }) {
    super();
    this.#db = new Database(params.dbPath);
    this.#legacyNodesPath = params.legacyNodesPath;
    const searchIndexCreated = this.#initDb();
    if (searchIndexCreated) this.#db.run("INSERT INTO memory_fts(memory_fts) VALUES ('rebuild')");
    this.#migrateLegacyContent();
  }

  // == Public API ==

  async search(query: string, limit = 3): Promise<MemoryNode[]> {
    const terms = parseMemorySearchTerms(query);
    if (terms.length === 0) return [];

    const candidateLimit = Math.max(limit * 10, 30);
    const ranks = new Map<string, number>();
    const ftsTerms = terms.filter((term) => Array.from(term).length >= 3);
    if (ftsTerms.length > 0) {
      const matchQuery = ftsTerms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
      const rows = this.#db.prepare(
        `SELECT nodes.id, bm25(memory_fts) AS rank
         FROM memory_fts JOIN nodes ON nodes.rowid = memory_fts.rowid
         WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`,
      ).all(matchQuery, candidateLimit) as Array<{ id: string; rank: number }>;
      for (const row of rows) ranks.set(row.id, row.rank);
    }

    const shortTerms = terms.filter((term) => Array.from(term).length < 3);
    if (shortTerms.length > 0) {
      const where = shortTerms
        .map(() => "instr(lower(content), lower(?)) > 0 OR instr(lower(tags), lower(?)) > 0")
        .join(" OR ");
      const params = shortTerms.flatMap((term) => [term, term]);
      const rows = this.#db.prepare(`SELECT id FROM nodes WHERE ${where} LIMIT ?`)
        .all(...params, candidateLimit) as Array<{ id: string }>;
      for (const row of rows) if (!ranks.has(row.id)) ranks.set(row.id, 0);
    }

    if (ranks.size === 0) return [];

    const nodes = [...ranks.keys()]
      .map((id) => this.#loadNode(id))
      .filter(Boolean)
      .sort((a, b) => {
        const relevance = this.#searchRelevance(b, terms) - this.#searchRelevance(a, terms);
        if (relevance !== 0) return relevance;
        const rank = (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0);
        return rank !== 0 ? rank : this.#score(b) - this.#score(a);
      })
      .slice(0, limit);

    for (const node of nodes) this.boostWeight(node.id);
    return nodes;
  }

  traverse(startId: string, maxSteps = 4): MemoryNode[] {
    const visited = new Set<string>();
    const results: MemoryNode[] = [];
    const queue = [{ id: startId, step: 0 }];

    while (queue.length > 0 && results.length < 5) {
      const { id, step } = queue.shift()!;
      if (visited.has(id) || step >= maxSteps) continue;
      visited.add(id);

      const node = this.#loadNode(id);
      if (node) results.push(node);

      const neighbors = this.#db.prepare(
        "SELECT target_id, relation FROM edges WHERE source_id = ?",
      ).all(id) as Array<{ target_id: string; relation: string }>;
      neighbors.sort((a, b) => this.#loadWeight(b.target_id) - this.#loadWeight(a.target_id));

      for (const neighbor of neighbors.slice(0, 3)) {
        if (!visited.has(neighbor.target_id)) queue.push({ id: neighbor.target_id, step: step + 1 });
      }
    }

    return results;
  }

  save(content: string, tags: string[] = []): string {
    const hash = createHash("sha256").update(content).digest("hex");
    const now = Date.now();
    this.#db.transaction(() => {
      this.#db.run(
        `INSERT INTO nodes (id, content, tags, weight, access_count, created_at, accessed_at)
         VALUES (?, ?, ?, 100, 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, tags = excluded.tags, accessed_at = excluded.accessed_at`,
        [hash, content, tags.join(","), now, now],
      );
    })();
    return hash;
  }

  has(id: string): boolean {
    return this.findFullId(id) !== null;
  }

  findFullId(memoryId: string): string | null {
    const key = memoryId.trim().toLowerCase();
    if (!/^[a-f0-9]+$/.test(key)) return null;

    const exact = this.#db.prepare("SELECT id FROM nodes WHERE id = ?").get(key) as { id: string } | null;
    if (exact) return exact.id;

    const rows = this.#db.prepare("SELECT id FROM nodes WHERE id LIKE ? ORDER BY id LIMIT 2")
      .all(`${key}%`) as Array<{ id: string }>;
    return rows.length === 1 ? rows[0].id : null;
  }

  link(source: string, target: string, relation: string): void {
    this.#db.run(
      "INSERT INTO edges (source_id, target_id, relation) VALUES (?, ?, ?)",
      [source, target, relation],
    );
  }

  forget(id: string): boolean {
    const fullMemoryId = this.findFullId(id);
    if (!fullMemoryId) return false;

    const result = this.#db.transaction(() => {
      this.#db.run("DELETE FROM edges WHERE source_id = ? OR target_id = ?", [fullMemoryId, fullMemoryId]);
      return this.#db.run("DELETE FROM nodes WHERE id = ?", [fullMemoryId]) as { changes?: number };
    })();
    return (result.changes ?? 0) > 0;
  }

  retain(id: string): void {
    const fullMemoryId = this.findFullId(id);
    if (!fullMemoryId) return;
    this.#db.run(
      "UPDATE nodes SET access_count = 0, weight = MIN(100, weight + 5), accessed_at = ? WHERE id = ?",
      [Date.now(), fullMemoryId],
    );
  }

  incrementAccess(id: string): void {
    this.#db.run("UPDATE nodes SET access_count = access_count + 1, accessed_at = ? WHERE id = ?", [Date.now(), id]);
  }

  boostWeight(id: string): void {
    this.#db.run("UPDATE nodes SET weight = MIN(100, weight + 5), accessed_at = ? WHERE id = ?", [Date.now(), id]);
  }

  decayWeight(id: string, amount: number): void {
    this.#db.run("UPDATE nodes SET weight = MAX(0, weight - ?) WHERE id = ?", [amount, id]);
  }

  // == Service lifecycle ==

  async start(): Promise<void> {
    await super.start();
    this.#timer = setInterval(() => this.#maintenance(), 5 * 60_000);
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    await super.stop();
  }

  // == Internal ==

  #initDb(): boolean {
    this.#db.run(`CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      tags TEXT DEFAULT '',
      weight REAL DEFAULT 100,
      access_count INTEGER DEFAULT 0,
      created_at INTEGER,
      accessed_at INTEGER
    )`);
    try { this.#db.run("ALTER TABLE nodes ADD COLUMN access_count INTEGER DEFAULT 0"); } catch { /* already exists */ }
    try { this.#db.run("ALTER TABLE nodes ADD COLUMN content TEXT NOT NULL DEFAULT ''"); } catch { /* already exists */ }

    this.#db.run(`CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL
    )`);
    this.#db.run("CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)");
    this.#db.run("CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)");

    const searchIndexExists = Boolean(this.#db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'",
    ).get());
    this.#db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      content,
      tags,
      content='nodes',
      content_rowid='rowid',
      tokenize='trigram'
    )`);
    this.#db.run(`CREATE TRIGGER IF NOT EXISTS nodes_fts_insert AFTER INSERT ON nodes BEGIN
      INSERT INTO memory_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
    END`);
    this.#db.run(`CREATE TRIGGER IF NOT EXISTS nodes_fts_delete AFTER DELETE ON nodes BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, content, tags) VALUES ('delete', old.rowid, old.content, old.tags);
    END`);
    this.#db.run(`CREATE TRIGGER IF NOT EXISTS nodes_fts_update AFTER UPDATE OF content, tags ON nodes BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, content, tags) VALUES ('delete', old.rowid, old.content, old.tags);
      INSERT INTO memory_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
    END`);
    return !searchIndexExists;
  }

  #migrateLegacyContent(): void {
    const path = this.#legacyNodesPath;
    if (!path || !existsSync(path)) return;

    const migratedFiles: string[] = [];
    const rows: Array<{ id: string; content: string }> = [];
    for (const file of readdirSync(path)) {
      if (!file.endsWith(".txt")) continue;
      const id = file.slice(0, -4);
      if (!this.#db.prepare("SELECT 1 FROM nodes WHERE id = ?").get(id)) continue;
      rows.push({ id, content: readFileSync(`${path}/${file}`, "utf-8") });
      migratedFiles.push(file);
    }

    this.#db.transaction(() => {
      const update = this.#db.prepare("UPDATE nodes SET content = ? WHERE id = ? AND content = ''");
      for (const row of rows) update.run(row.content, row.id);
    })();
    for (const file of migratedFiles) {
      try { unlinkSync(`${path}/${file}`); } catch { /* content is already authoritative in SQLite */ }
    }
    try { rmdirSync(path); } catch { /* keep unknown legacy files for manual recovery */ }
  }

  #loadNode(id: string): MemoryNode | null {
    const row = this.#db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      content: row.content as string,
      tags: row.tags ? (row.tags as string).split(",").filter(Boolean) : [],
      weight: row.weight as number,
      accessCount: (row.access_count as number) ?? 0,
      createdAt: row.created_at as number,
      accessedAt: row.accessed_at as number,
    };
  }

  #loadWeight(id: string): number {
    const row = this.#db.prepare("SELECT weight FROM nodes WHERE id = ?").get(id) as any;
    return row?.weight ?? 0;
  }

  #score(node: MemoryNode): number {
    const daysOld = (Date.now() - node.createdAt) / 86400000;
    const recency = Math.max(0, 1 - daysOld / 30);
    return node.weight * 0.7 + recency * 30;
  }

  #searchRelevance(node: MemoryNode, terms: string[]): number {
    const text = `${node.content}\n${node.tags.join(" ")}`.toLowerCase();
    let relevance = 0;
    for (let i = 0; i < terms.length; i++) {
      if (text.includes(terms[i])) relevance += 1000 + (terms.length - i) * 10;
    }
    return relevance;
  }

  #maintenance(): void {
    this.#db.run(
      `UPDATE nodes SET weight = MAX(0, weight - (julianday('now') - julianday(created_at / 1000.0, 'unixepoch')) * 1)`,
    );
  }
}
