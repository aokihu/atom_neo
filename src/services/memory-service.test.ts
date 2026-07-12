import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import { parseMemorySearchTerms } from "@atom-neo/shared";
import { MemoryService } from "./memory-service";

function createMemoryService(): { service: MemoryService; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "atom-memory-"));
  return {
    service: new MemoryService({
      dbPath: join(dir, "memory.db"),
      legacyNodesPath: join(dir, "nodes"),
    }),
    dir,
  };
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe("MemoryService save", () => {
  test("does not reset lifecycle when saving duplicate content", () => {
    const { service, dir } = createMemoryService();
    try {
      const id = service.save("stable memory", ["first"]);
      service.incrementAccess(id);
      service.decayWeight(id, 25);

      expect(service.save("stable memory", ["second"])).toBe(id);

      const [node] = service.traverse(id);
      expect(node.accessCount).toBe(1);
      expect(node.weight).toBe(75);
      expect(node.tags).toEqual(["second"]);
    } finally {
      cleanup(dir);
    }
  });

  test("stores content only in SQLite and keeps FTS tags synchronized", async () => {
    const { service, dir } = createMemoryService();
    try {
      const id = service.save("existing memory");
      service.save("existing memory", ["durable-index"]);
      const db = new Database(join(dir, "memory.db"));
      const row = db.prepare("SELECT content, tags FROM nodes WHERE id = ?").get(id) as { content: string; tags: string };

      expect(row).toEqual({ content: "existing memory", tags: "durable-index" });
      expect(existsSync(join(dir, "nodes"))).toBe(false);
      expect((await service.search("durable-index"))[0]?.id).toBe(id);
      db.close();
    } finally {
      cleanup(dir);
    }
  });

  test("migrates legacy text content into SQLite and removes migrated files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atom-memory-legacy-"));
    const dbPath = join(dir, "memory.db");
    const nodesPath = join(dir, "nodes");
    const content = "旧台风查询技能记忆";
    const id = createHash("sha256").update(content).digest("hex");
    mkdirSync(nodesPath);
    writeFileSync(join(nodesPath, `${id}.txt`), content);
    const db = new Database(dbPath);
    db.run(`CREATE TABLE nodes (
      id TEXT PRIMARY KEY, tags TEXT DEFAULT '', weight REAL DEFAULT 100,
      access_count INTEGER DEFAULT 0, created_at INTEGER, accessed_at INTEGER
    )`);
    db.run("INSERT INTO nodes VALUES (?, 'typhoon', 100, 0, ?, ?)", [id, Date.now(), Date.now()]);
    db.close();

    try {
      const service = new MemoryService({ dbPath, legacyNodesPath: nodesPath });

      expect(service.traverse(id)[0]?.content).toBe(content);
      expect((await service.search("台风查询"))[0]?.id).toBe(id);
      expect(existsSync(join(nodesPath, `${id}.txt`))).toBe(false);
      expect(existsSync(nodesPath)).toBe(false);
    } finally {
      cleanup(dir);
    }
  });
});

describe("MemoryService search", () => {
  test("parses broad terms and ignores a year when concepts are present", () => {
    expect(parseMemorySearchTerms("台风 最新 2026")).toEqual(["台风"]);
    expect(parseMemorySearchTerms("2026")).toEqual(["2026"]);
    expect(parseMemorySearchTerms("查询一下台风最新动向")).toContain("台风");
  });

  test("finds capability memory by a core keyword", async () => {
    const { service, dir } = createMemoryService();
    try {
      service.save("查询台风信息时使用 Typhoon Skill。", ["skill", "typhoon"]);

      const results = await service.search("台风");

      expect(results).toHaveLength(1);
      expect(results[0].content).toContain("Typhoon Skill");
    } finally {
      cleanup(dir);
    }
  });

  test("matches any broad query term instead of the complete phrase", async () => {
    const { service, dir } = createMemoryService();
    try {
      service.save("查询台风信息时使用 Typhoon Skill。", ["skill", "typhoon"]);

      const results = await service.search("台风 最新 2026");

      expect(results).toHaveLength(1);
      expect(results[0].content).toContain("Typhoon Skill");
    } finally {
      cleanup(dir);
    }
  });

  test("matches a useful part of an unsegmented Chinese query", async () => {
    const { service, dir } = createMemoryService();
    try {
      service.save("台风资料应通过 Typhoon Skill 获取。", ["skill"]);

      const results = await service.search("查询一下台风最新动向");

      expect(results.some((node) => node.content.includes("Typhoon Skill"))).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test("searches tags and prioritizes more relevant terms", async () => {
    const { service, dir } = createMemoryService();
    try {
      service.save("通用气象资料。", ["typhoon-skill"]);
      service.save("2026 年最新项目状态。", ["status"]);

      const results = await service.search("typhoon 最新 2026", 2);

      expect(results[0].tags).toContain("typhoon-skill");
    } finally {
      cleanup(dir);
    }
  });
});

describe("MemoryService findFullId", () => {
  test("resolves exact and unique short IDs", () => {
    const { service, dir } = createMemoryService();
    try {
      const id = service.save("user prefers concise answers", ["preference"]);

      expect(service.findFullId(id)).toBe(id);
      expect(service.findFullId(id.slice(0, 6))).toBe(id);
      expect(service.has(id.slice(0, 6))).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test("does not resolve ambiguous short IDs", () => {
    const { service, dir } = createMemoryService();
    try {
      const idsByPrefix = new Map<string, string[]>();

      for (let i = 0; i < 80; i++) {
        const id = service.save(`collision candidate ${i}`);
        const prefix = id.slice(0, 1);
        idsByPrefix.set(prefix, [...(idsByPrefix.get(prefix) ?? []), id]);
      }

      const ambiguousPrefix = [...idsByPrefix.entries()].find(([, ids]) => ids.length > 1)?.[0];
      expect(ambiguousPrefix).toBeDefined();
      expect(service.findFullId(ambiguousPrefix!)).toBeNull();
      expect(service.has(ambiguousPrefix!)).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  test("rejects non-hash IDs", () => {
    const { service, dir } = createMemoryService();
    try {
      service.save("valid memory");

      expect(service.findFullId("not-a-hash")).toBeNull();
      expect(service.has("not-a-hash")).toBe(false);
    } finally {
      cleanup(dir);
    }
  });
});

describe("MemoryService forget", () => {
  test("deletes memory content and metadata by short ID", async () => {
    const { service, dir } = createMemoryService();
    try {
      const id = service.save("memory to forget", ["cleanup"]);
      const otherId = service.save("related memory", ["cleanup"]);
      service.link(id, otherId, "relates_to");

      expect((await service.search("forget"))[0]?.id).toBe(id);
      expect(service.forget(id.slice(0, 6))).toBe(true);

      expect(service.has(id)).toBe(false);
      expect(service.traverse(id)).toEqual([]);
      expect(await service.search("forget")).toEqual([]);
      expect(service.has(otherId)).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test("returns false for missing memory", () => {
    const { service, dir } = createMemoryService();
    try {
      expect(service.forget("abcdef")).toBe(false);
    } finally {
      cleanup(dir);
    }
  });
});
