import { describe, test, expect } from "bun:test";
import {
  createSearchMemoryTool,
  createReadMemoryTool,
  createSaveMemoryTool,
  createTraverseMemoryTool,
  createLinkMemoryTool,
  createForgetMemoryTool,
} from "./memory";

const search = createSearchMemoryTool();
const read = createReadMemoryTool();
const save = createSaveMemoryTool();
const traverse = createTraverseMemoryTool();
const link = createLinkMemoryTool();
const forget = createForgetMemoryTool();

describe("saveMemoryTool", () => {
  test("returns error when no memory service", async () => {
    const result = await save.execute({ content: "test memory", tags: ["test"] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("memory service not connected");
  });

  test("returns error when memory service save fails", async () => {
    const tool = createSaveMemoryTool({
      save: () => {
        throw new Error("disk full");
      },
    });

    const result = await tool.execute({ content: "test memory", tags: ["test"] });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("disk full");
  });

  test("passes an optional summary to the memory service", async () => {
    let savedArgs: unknown[] = [];
    const tool = createSaveMemoryTool({
      save: (...args: unknown[]) => {
        savedArgs = args;
        return "abcdef123456";
      },
    });

    const result = await tool.execute({ content: "full memory", summary: "short preview", tags: ["test"] });

    expect(result.ok).toBe(true);
    expect(savedArgs).toEqual(["full memory", ["test"], "short preview", {
      baseWeight: undefined,
      confidence: undefined,
      kind: undefined,
      pinned: undefined,
      supersedesId: undefined,
    }]);
  });

  test("passes a superseded memory ID to the atomic save operation", async () => {
    let options: Record<string, unknown> = {};
    const tool = createSaveMemoryTool({
      save: (_content: string, _tags: string[], _summary: string | undefined, value: Record<string, unknown>) => {
        options = value;
        return "abcdef123456";
      },
    });

    const result = await tool.execute({ content: "new fact", supersedesId: "abc123" });

    expect(result.ok).toBe(true);
    expect(options.supersedesId).toBe("abc123");
  });
});

describe("searchMemoryTool", () => {
  test("returns placeholder when no memory service", async () => {
    const result = await search.execute({ query: "test" });
    expect(result.ok).toBe(true);
  });

  test("returns short IDs with summaries but not full content", async () => {
    const tool = createSearchMemoryTool({
      search: () => [{
        id: "abcdef1234567890",
        content: "CODE=9528 is a remembered identifier.",
        summary: "Remembered identifier",
        tags: ["identifier"],
      }],
    });

    const result = await tool.execute({ query: "CODE=9528" });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('<MemorySummary id="abcdef" tags="identifier">');
    expect(result.output).toContain("Remembered identifier");
    expect(result.output).not.toContain("CODE=9528 is a remembered identifier.");
  });

  test("asks for a non-overlapping retry when no memory matches", async () => {
    let query = "";
    const tool = createSearchMemoryTool({
      search: (value: string) => {
        query = value;
        return [];
      },
    });

    const result = await tool.execute({ query: "台风 最新 2026" });

    expect(query).toBe("台风 最新 2026");
    expect(result.output).toContain("different, non-overlapping keywords");
  });
});

describe("readMemoryTool", () => {
  test("returns error when no memory service", async () => {
    const result = await read.execute({ id: "abc123" });
    expect(result.ok).toBe(false);
  });

  test("returns full content for a selected summary ID", async () => {
    let recordedId = "";
    const tool = createReadMemoryTool({
      getById: () => ({
        id: "abcdef1234567890",
        content: "CODE=9528 is a remembered identifier.",
        summary: "Remembered identifier",
        tags: ["identifier"],
      }),
      recordRead: (id: string) => { recordedId = id; },
    });

    const result = await tool.execute({ id: "abcdef" });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('<Memory id="abcdef" tags="identifier">');
    expect(result.output).toContain("CODE=9528 is a remembered identifier.");
    expect(recordedId).toBe("abcdef1234567890");
    expect(result.contextInjection).toBeUndefined();
  });

  test("requests a pinned session projection when explicitly selected", async () => {
    const tool = createReadMemoryTool({
      getById: () => ({
        id: "abcdef1234567890",
        content: "Persistent workflow guidance.",
        summary: "Workflow guidance",
        tags: ["workflow"],
      }),
    });

    const result = await tool.execute({
      id: "abcdef",
      injectToContext: { retention: "pinned" },
    });

    expect(result.contextInjection).toEqual({
      scope: "session",
      entry: {
        key: "memory:abcdef1234567890",
        source: "memory",
        channel: "messages",
        trust: "untrusted",
        priority: 650,
        pinned: true,
        content: [{
          role: "assistant",
          content: '<Memory id="abcdef" tags="workflow">\nPersistent workflow guidance.\n</Memory>',
        }],
      },
    });
  });

  test("requests a temporary topic projection with an explicit expiry", async () => {
    const tool = createReadMemoryTool({
      getById: () => ({
        id: "abcdef1234567890",
        content: "How to query the weather.",
        summary: "Weather workflow",
        tags: ["weather"],
      }),
    });
    const before = Date.now();

    const result = await tool.execute({
      id: "abcdef",
      injectToContext: { retention: "ttl", ttlSeconds: 900 },
    });

    const expiresAt = result.contextInjection?.entry.expiresAt;
    expect(result.contextInjection?.scope).toBe("topic");
    expect(result.contextInjection?.entry.pinned).toBeUndefined();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 900_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 900_000);
  });

  test("rejects a ttl projection without ttlSeconds", async () => {
    const tool = createReadMemoryTool({ getById: () => null });
    const result = await tool.execute({
      id: "abcdef",
      injectToContext: { retention: "ttl" },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ttlSeconds");
  });

  test("returns error when the selected memory is missing", async () => {
    const tool = createReadMemoryTool({ getById: () => null });
    const result = await tool.execute({ id: "abc123" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Memory not found: abc123");
  });
});

describe("traverseMemoryTool", () => {
  test("returns placeholder when no memory service", async () => {
    const result = await traverse.execute({ startId: "test" });
    expect(result.ok).toBe(true);
  });

  test("returns summaries and IDs without exposing full content", async () => {
    const tool = createTraverseMemoryTool({
      traverse: () => [{
        id: "abcdef1234567890",
        content: "private full memory body",
        summary: "Related workflow",
        tags: ["workflow"],
        sourceId: "1234567890abcdef",
        relation: "depends_on",
        depth: 1,
      }],
    });

    const result = await tool.execute({ startId: "abcdef" });

    expect(result.output).toContain('<MemorySummary id="abcdef" tags="workflow" sourceId="123456" relation="depends_on" depth="1">');
    expect(result.output).toContain("Related workflow");
    expect(result.output).not.toContain("private full memory body");
    expect(result.data).toEqual([{
      id: "abcdef1234567890",
      summary: "Related workflow",
      tags: ["workflow"],
      sourceId: "1234567890abcdef",
      relation: "depends_on",
      depth: 1,
    }]);
  });
});

describe("linkMemoryTool", () => {
  test("returns ok when no memory service", async () => {
    const result = await link.execute({ source: "a", target: "b", relation: "relates_to" });
    expect(result.ok).toBe(true);
  });
});

describe("forgetMemoryTool", () => {
  test("returns error when no memory service", async () => {
    const result = await forget.execute({ id: "abc123" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("memory service not connected");
  });

  test("returns error when memory is missing", async () => {
    const tool = createForgetMemoryTool({
      forget: () => false,
    });

    const result = await tool.execute({ id: "abc123" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Memory not found: abc123");
  });

  test("rejects memory content passed as an ID", async () => {
    let forgetCalled = false;
    const tool = createForgetMemoryTool({
      forget: () => {
        forgetCalled = true;
        return true;
      },
    });

    const result = await tool.execute({ id: "CODE=9528 is a remembered identifier." });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Memory ID must be a full or short hexadecimal ID");
    expect(forgetCalled).toBe(false);
  });

  test("forgets memory by ID", async () => {
    const tool = createForgetMemoryTool({
      forget: () => true,
    });

    const result = await tool.execute({ id: "abc123" });

    expect(result.ok).toBe(true);
    expect(result.output).toBe("Forgot memory: abc123");
  });
});
