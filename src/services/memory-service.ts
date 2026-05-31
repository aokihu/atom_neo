import { BaseService } from "./base-service";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

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
  #nodesPath: string;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(params: { dbPath: string; nodesPath: string }) {
    super();
    this.#db = new Database(params.dbPath);
    this.#nodesPath = params.nodesPath;
    this.#initDb();
  }

  // == Public API ==

  async search(query: string, limit = 3): Promise<MemoryNode[]> {
    if (!query.trim()) return [];

    const sanitized = query.replace(/['"`\\]/g, "");
    let hits: string[] = [];

    try {
      const proc = Bun.spawn(
        ["rg", "--max-count", String(limit), "--json", "-i", sanitized, `${this.#nodesPath}/`],
        { stdout: "pipe", stderr: "pipe" },
      );
      const output = await new Response(proc.stdout).text();
      proc.kill();

      for (const line of output.trim().split("\n")) {
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          if (m.type === "match") {
            const file = m.data.path.text.replace(/^.*nodes\//, "").replace(".txt", "");
            if (!hits.includes(file)) hits.push(file);
          }
        } catch { /* skip non-JSON rg line */ }
      }
    } catch (err) {
      this.logger?.error("rg search failed", { error: String(err) });
      hits = this.#fallbackSearch(sanitized.toLowerCase());
    }

    if (hits.length === 0) return [];

    // 2. Load from SQLite + sort by weight × recency
    const nodes = hits
      .map((id) => this.#loadNode(id))
      .filter(Boolean)
      .sort((a, b) => this.#score(b) - this.#score(a))
      .slice(0, limit);

    // 3. Boost weights
    for (const n of nodes) this.boostWeight(n.id);

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

      // Neighbors sorted by target weight
      const stmt = this.#db.prepare(
        "SELECT target_id, relation FROM edges WHERE source_id = ?",
      );
      const neighbors = stmt.all(id) as Array<{ target_id: string; relation: string }>;
      neighbors.sort((a, b) => {
        const aw = this.#loadWeight(a.target_id);
        const bw = this.#loadWeight(b.target_id);
        return bw - aw;
      });

      for (const n of neighbors.slice(0, 3)) {
        if (!visited.has(n.target_id)) queue.push({ id: n.target_id, step: step + 1 });
      }
    }

    return results;
  }

  save(content: string, tags: string[] = []): string {
    const hash = createHash("sha256").update(content).digest("hex");
    const now = Date.now();

    // Write .txt file
    mkdirSync(this.#nodesPath, { recursive: true });
    writeFileSync(`${this.#nodesPath}/${hash}.txt`, content, "utf-8");

    // Insert metadata
    this.#db.run(
      "INSERT OR REPLACE INTO nodes (id, tags, weight, access_count, created_at, accessed_at) VALUES (?, ?, ?, 0, ?, ?)",
      [hash, tags.join(","), 100, now, now],
    );

    return hash;
  }

  has(id: string): boolean {
    const row = this.#db.prepare("SELECT 1 FROM nodes WHERE id = ?").get(id);
    return row !== null;
  }

  link(source: string, target: string, relation: string): void {
    this.#db.run(
      "INSERT INTO edges (source_id, target_id, relation) VALUES (?, ?, ?)",
      [source, target, relation],
    );
  }

  keep(id: string): void {
    this.#db.run(
      "UPDATE nodes SET access_count = 0, weight = MIN(100, weight + 5), accessed_at = ? WHERE id = ?",
      [Date.now(), id],
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
    mkdirSync(this.#nodesPath, { recursive: true });
    this.#timer = setInterval(() => this.#maintenance(), 5 * 60_000);
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    await super.stop();
  }

  // == Internal ==

  #initDb(): void {
    this.#db.run(`CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      tags TEXT DEFAULT '',
      weight REAL DEFAULT 100,
      access_count INTEGER DEFAULT 0,
      created_at INTEGER,
      accessed_at INTEGER
    )`);
    // Migration: add access_count if table was created without it
    try { this.#db.run("ALTER TABLE nodes ADD COLUMN access_count INTEGER DEFAULT 0"); } catch { /* already exists */ }
    this.#db.run(`CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL
    )`);
    try { this.#db.run("CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)"); } catch {}
    try { this.#db.run("CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)"); } catch {}
  }

  #loadNode(id: string): MemoryNode | null {
    const stmt = this.#db.prepare("SELECT * FROM nodes WHERE id = ?");
    const row = stmt.get(id) as any;
    if (!row) return null;

    let content = "";
    try {
      content = readFileSync(`${this.#nodesPath}/${id}.txt`, "utf-8");
    } catch {
      return null;
    }

    return {
      id: row.id,
      content,
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
    const recency = Math.max(0, 1 - daysOld / 30); // 30 天内衰减线性
    return node.weight * 0.7 + recency * 30;
  }

  #fallbackSearch(query: string): string[] {
    const results: string[] = [];
    if (!existsSync(this.#nodesPath)) return results;
    const files = new Bun.Glob("*.txt").scanSync(this.#nodesPath);
    for (const file of files) {
      try {
        const content = readFileSync(`${this.#nodesPath}/${file}`, "utf-8").toLowerCase();
        if (content.includes(query)) {
          results.push(file.replace(".txt", ""));
        }
      } catch { /* skip */ }
    }
    return results;
  }

  #maintenance(): void {
    // Decay: daily -1 per day since creation
    this.#db.run(
      `UPDATE nodes SET weight = MAX(0, weight - (julianday('now') - julianday(created_at / 1000.0, 'unixepoch')) * 1)`,
    );
  }
}
