import { BaseService } from "./base-service";
import { parseMemorySearchTerms } from "@atom-neo/shared";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import {
  calculateDecayedUsage,
  calculateFinalMemoryScore,
  calculateGraphScore,
  calculateMemoryQuality,
  calculateRetrievalRelevance,
} from "./memory-ranking";
import type { MemoryKind } from "./memory-ranking";

export type MemoryNode = {
  id: string;
  content: string;
  summary: string;
  tags: string[];
  baseWeight: number;
  usageScore: number;
  retrievalCount: number;
  readCount: number;
  kind: MemoryKind;
  confidence: number;
  pinned: boolean;
  lastReadAt: number | null;
  lastConfirmedAt: number | null;
  usageUpdatedAt: number | null;
  createdAt: number;
  accessedAt: number;
};

export type MemorySaveOptions = {
  baseWeight?: number;
  kind?: MemoryKind;
  confidence?: number;
  pinned?: boolean;
};

export class MemoryService extends BaseService {
  readonly name = "memory";

  #db: Database;
  #legacyNodesPath?: string;
  #now: () => number;

  constructor(params: { dbPath: string; legacyNodesPath?: string; now?: () => number }) {
    super();
    this.#db = new Database(params.dbPath);
    this.#legacyNodesPath = params.legacyNodesPath;
    this.#now = params.now ?? Date.now;
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
        .map(() => "instr(lower(summary), lower(?)) > 0 OR instr(lower(content), lower(?)) > 0 OR instr(lower(tags), lower(?)) > 0")
        .join(" OR ");
      const params = shortTerms.flatMap((term) => [term, term, term]);
      const rows = this.#db.prepare(`SELECT id FROM nodes WHERE ${where} LIMIT ?`)
        .all(...params, candidateLimit) as Array<{ id: string }>;
      for (const row of rows) if (!ranks.has(row.id)) ranks.set(row.id, 0);
    }

    if (ranks.size === 0) return [];

    const candidates = [...ranks.keys()]
      .map((id) => this.#loadNode(id))
      .filter(Boolean)
      .filter((node) => !this.#isSuperseded(node.id));
    const rankOrder = new Map(
      candidates
        .map((node) => node.id)
        .sort((a, b) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0))
        .map((id, index) => [id, index]),
    );
    const nodes = candidates
      .map((node) => {
        const relevance = calculateRetrievalRelevance({
          matchedTermCount: this.#matchedTermCount(node, terms),
          totalTermCount: terms.length,
          rankIndex: rankOrder.get(node.id) ?? candidates.length - 1,
          candidateCount: candidates.length,
        });
        return { node, score: calculateFinalMemoryScore(relevance, this.#memoryQuality(node)) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ node }) => node);

    const markRetrieved = this.#db.prepare(
      "UPDATE nodes SET retrieval_count = retrieval_count + 1, accessed_at = ? WHERE id = ?",
    );
    const now = this.#now();
    this.#db.transaction(() => {
      for (const node of nodes) markRetrieved.run(now, node.id);
    })();
    return nodes;
  }

  traverse(startId: string, maxSteps = 4): MemoryNode[] {
    const fullStartId = this.findFullId(startId);
    if (!fullStartId) return [];
    const visited = new Set<string>();
    const results: MemoryNode[] = [];
    const queue = [{ id: fullStartId, step: 0 }];

    while (queue.length > 0 && results.length < 5) {
      const { id, step } = queue.shift()!;
      if (visited.has(id) || step >= maxSteps) continue;
      visited.add(id);

      const node = this.#loadNode(id);
      if (node) results.push(node);

      const neighbors = this.#db.prepare(
        "SELECT target_id, relation FROM edges WHERE source_id = ?",
      ).all(id) as Array<{ target_id: string; relation: string }>;
      neighbors.sort((a, b) => {
        const aNode = this.#loadNode(a.target_id);
        const bNode = this.#loadNode(b.target_id);
        return (bNode ? this.#memoryQuality(bNode) : 0) - (aNode ? this.#memoryQuality(aNode) : 0);
      });

      for (const neighbor of neighbors.slice(0, 3)) {
        if (!visited.has(neighbor.target_id)) queue.push({ id: neighbor.target_id, step: step + 1 });
      }
    }

    return results;
  }

  save(content: string, tags: string[] = [], summary?: string, options: MemorySaveOptions = {}): string {
    const hash = createHash("sha256").update(content).digest("hex");
    const now = this.#now();
    const storedSummary = this.#selectSummary(content, summary);
    const baseWeight = Math.min(100, Math.max(0, options.baseWeight ?? 60));
    const kind = options.kind ?? "stable_fact";
    const confidence = Math.min(1, Math.max(0, options.confidence ?? 1));
    const pinned = options.pinned ? 1 : 0;
    this.#db.transaction(() => {
      this.#db.run(
        `INSERT INTO nodes (
           id, content, summary, tags, weight, access_count, base_weight, usage_score,
           retrieval_count, read_count, kind, confidence, pinned, last_confirmed_at,
           usage_updated_at, created_at, accessed_at
         ) VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content,
           summary = excluded.summary,
           tags = excluded.tags,
           base_weight = MAX(nodes.base_weight, excluded.base_weight),
           weight = MAX(nodes.weight, excluded.weight),
           kind = CASE WHEN ? THEN excluded.kind ELSE nodes.kind END,
           confidence = CASE WHEN ? THEN excluded.confidence ELSE nodes.confidence END,
           pinned = MAX(nodes.pinned, excluded.pinned),
           last_confirmed_at = excluded.last_confirmed_at,
           accessed_at = excluded.accessed_at`,
        [
          hash, content, storedSummary, tags.join(","), baseWeight, baseWeight, kind, confidence,
          pinned, now, now, now, now, options.kind !== undefined, options.confidence !== undefined,
        ],
      );
    })();
    return hash;
  }

  has(id: string): boolean {
    return this.findFullId(id) !== null;
  }

  getById(memoryId: string): MemoryNode | null {
    const fullMemoryId = this.findFullId(memoryId);
    return fullMemoryId ? this.#loadNode(fullMemoryId) : null;
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

  link(source: string, target: string, relation: string): boolean {
    const sourceId = this.findFullId(source);
    const targetId = this.findFullId(target);
    if (!sourceId || !targetId) return false;
    this.#db.run(
      "INSERT OR IGNORE INTO edges (source_id, target_id, relation) VALUES (?, ?, ?)",
      [sourceId, targetId, relation],
    );
    return true;
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
    const now = this.#now();
    this.#db.run(
      `UPDATE nodes SET
         base_weight = MIN(100, base_weight + 10),
         weight = MIN(100, base_weight + 10),
         last_confirmed_at = ?,
         accessed_at = ?
       WHERE id = ?`,
      [now, now, fullMemoryId],
    );
  }

  recordRead(id: string): void {
    const row = this.#db.prepare(
      "SELECT usage_score, usage_updated_at FROM nodes WHERE id = ?",
    ).get(id) as { usage_score: number; usage_updated_at: number | null } | null;
    if (!row) return;
    const now = this.#now();
    const usageScore = calculateDecayedUsage(row.usage_score, row.usage_updated_at, now) + 1;
    this.#db.run(
      `UPDATE nodes SET
         usage_score = ?,
         read_count = read_count + 1,
         access_count = access_count + 1,
         last_read_at = ?,
         usage_updated_at = ?,
         accessed_at = ?
       WHERE id = ?`,
      [usageScore, now, now, now, id],
    );
  }

  // == Service lifecycle ==

  async start(): Promise<void> {
    await super.start();
  }

  async stop(): Promise<void> {
    await super.stop();
  }

  // == Internal ==

  #initDb(): boolean {
    this.#db.run(`CREATE TABLE IF NOT EXISTS nodes (
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
      last_read_at INTEGER,
      last_confirmed_at INTEGER,
      usage_updated_at INTEGER,
      created_at INTEGER,
      accessed_at INTEGER
    )`);
    const nodeColumns = new Set(
      (this.#db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    const addColumn = (name: string, sql: string) => {
      if (nodeColumns.has(name)) return false;
      this.#db.run(`ALTER TABLE nodes ADD COLUMN ${sql}`);
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
    const lastReadAdded = addColumn("last_read_at", "last_read_at INTEGER");
    const lastConfirmedAdded = addColumn("last_confirmed_at", "last_confirmed_at INTEGER");
    const usageUpdatedAdded = addColumn("usage_updated_at", "usage_updated_at INTEGER");
    this.#db.run("UPDATE nodes SET summary = content WHERE summary = ''");
    if (baseWeightAdded) this.#db.run("UPDATE nodes SET base_weight = weight");
    if (usageScoreAdded) this.#db.run("UPDATE nodes SET usage_score = MIN(access_count, 4)");
    if (readCountAdded) this.#db.run("UPDATE nodes SET read_count = access_count");
    if (lastReadAdded) this.#db.run("UPDATE nodes SET last_read_at = accessed_at WHERE access_count > 0");
    if (lastConfirmedAdded) this.#db.run("UPDATE nodes SET last_confirmed_at = created_at");
    if (usageUpdatedAdded) this.#db.run("UPDATE nodes SET usage_updated_at = COALESCE(accessed_at, created_at)");

    this.#db.run(`CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL
    )`);
    this.#db.run("CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)");
    this.#db.run("CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)");
    this.#db.run(`DELETE FROM edges WHERE id NOT IN (
      SELECT MIN(id) FROM edges GROUP BY source_id, target_id, relation
    )`);
    this.#db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique ON edges(source_id, target_id, relation)");

    const searchIndexExists = Boolean(this.#db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'",
    ).get());
    const searchIndexColumns = searchIndexExists
      ? this.#db.prepare("PRAGMA table_info(memory_fts)").all() as Array<{ name: string }>
      : [];
    const searchIndexNeedsRebuild = !searchIndexExists || !searchIndexColumns.some((column) => column.name === "summary");
    this.#db.run("DROP TRIGGER IF EXISTS nodes_fts_insert");
    this.#db.run("DROP TRIGGER IF EXISTS nodes_fts_delete");
    this.#db.run("DROP TRIGGER IF EXISTS nodes_fts_update");
    if (searchIndexExists && searchIndexNeedsRebuild) this.#db.run("DROP TABLE memory_fts");
    this.#db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      summary,
      content,
      tags,
      content='nodes',
      content_rowid='rowid',
      tokenize='trigram'
    )`);
    this.#db.run(`CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes BEGIN
      INSERT INTO memory_fts(rowid, summary, content, tags) VALUES (new.rowid, new.summary, new.content, new.tags);
    END`);
    this.#db.run(`CREATE TRIGGER nodes_fts_delete AFTER DELETE ON nodes BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, summary, content, tags) VALUES ('delete', old.rowid, old.summary, old.content, old.tags);
    END`);
    this.#db.run(`CREATE TRIGGER nodes_fts_update AFTER UPDATE OF summary, content, tags ON nodes BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, summary, content, tags) VALUES ('delete', old.rowid, old.summary, old.content, old.tags);
      INSERT INTO memory_fts(rowid, summary, content, tags) VALUES (new.rowid, new.summary, new.content, new.tags);
    END`);
    return searchIndexNeedsRebuild;
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
      const update = this.#db.prepare("UPDATE nodes SET content = ?, summary = ? WHERE id = ? AND content = ''");
      for (const row of rows) update.run(row.content, row.content, row.id);
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
      summary: row.summary as string,
      tags: row.tags ? (row.tags as string).split(",").filter(Boolean) : [],
      baseWeight: row.base_weight as number,
      usageScore: row.usage_score as number,
      retrievalCount: row.retrieval_count as number,
      readCount: row.read_count as number,
      kind: row.kind as MemoryKind,
      confidence: row.confidence as number,
      pinned: Boolean(row.pinned),
      lastReadAt: row.last_read_at as number | null,
      lastConfirmedAt: row.last_confirmed_at as number | null,
      usageUpdatedAt: row.usage_updated_at as number | null,
      createdAt: row.created_at as number,
      accessedAt: row.accessed_at as number,
    };
  }

  #matchedTermCount(node: MemoryNode, terms: string[]): number {
    const text = `${node.summary}\n${node.content}\n${node.tags.join(" ")}`.toLowerCase();
    return terms.filter((term) => text.includes(term)).length;
  }

  #memoryQuality(node: MemoryNode): number {
    const references = this.#db.prepare(
      `SELECT edges.relation, nodes.base_weight AS sourceBaseWeight
       FROM edges JOIN nodes ON nodes.id = edges.source_id
       WHERE edges.target_id = ? AND edges.relation != 'supersedes'`,
    ).all(node.id) as Array<{ relation: string; sourceBaseWeight: number }>;
    return calculateMemoryQuality({
      baseWeight: node.baseWeight,
      usageScore: node.usageScore,
      usageUpdatedAt: node.usageUpdatedAt,
      graphScore: calculateGraphScore(references),
      kind: node.kind,
      confidence: node.confidence,
      pinned: node.pinned,
      lastConfirmedAt: node.lastConfirmedAt,
      createdAt: node.createdAt,
      now: this.#now(),
    });
  }

  #isSuperseded(id: string): boolean {
    return Boolean(this.#db.prepare(
      "SELECT 1 FROM edges WHERE target_id = ? AND relation = 'supersedes' LIMIT 1",
    ).get(id));
  }

  #selectSummary(content: string, summary?: string): string {
    const candidate = summary?.trim();
    if (!candidate) return content;
    const contentLength = Array.from(content).length;
    const summaryLength = Array.from(candidate).length;
    return contentLength === 0 || summaryLength >= contentLength * 0.8 ? content : candidate;
  }

}
