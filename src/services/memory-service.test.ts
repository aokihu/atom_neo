import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryService } from "./memory-service";

function createMemoryService(): { service: MemoryService; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "atom-memory-"));
  return {
    service: new MemoryService({
      dbPath: join(dir, "memory.db"),
      nodesPath: join(dir, "nodes"),
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

  test("cleans temp file and metadata when final content write fails", () => {
    const { service, dir } = createMemoryService();
    try {
      const id = service.save("existing memory");
      service.forget(id);
      mkdirSync(join(dir, "nodes", `${id}.txt`));

      expect(() => service.save("existing memory")).toThrow();
      expect(service.has(id)).toBe(false);
      expect(readdirSync(join(dir, "nodes")).some((file) => file.endsWith(".tmp"))).toBe(false);
    } finally {
      cleanup(dir);
    }
  });
});

describe("MemoryService search", () => {
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
  test("deletes memory content and metadata by short ID", () => {
    const { service, dir } = createMemoryService();
    try {
      const id = service.save("memory to forget", ["cleanup"]);
      const otherId = service.save("related memory", ["cleanup"]);
      service.link(id, otherId, "relates_to");

      expect(existsSync(join(dir, "nodes", `${id}.txt`))).toBe(true);
      expect(service.forget(id.slice(0, 6))).toBe(true);

      expect(service.has(id)).toBe(false);
      expect(service.traverse(id)).toEqual([]);
      expect(existsSync(join(dir, "nodes", `${id}.txt`))).toBe(false);
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
