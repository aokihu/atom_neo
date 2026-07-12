import { describe, test, expect } from "bun:test";
import {
  createSearchMemoryTool,
  createSaveMemoryTool,
  createTraverseMemoryTool,
  createLinkMemoryTool,
  createForgetMemoryTool,
} from "./memory";

const search = createSearchMemoryTool();
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
});

describe("searchMemoryTool", () => {
  test("returns placeholder when no memory service", async () => {
    const result = await search.execute({ query: "test" });
    expect(result.ok).toBe(true);
  });

  test("returns short IDs with matching memory content", async () => {
    const tool = createSearchMemoryTool({
      search: () => [{
        id: "abcdef1234567890",
        content: "CODE=9528 is a remembered identifier.",
        tags: ["identifier"],
      }],
    });

    const result = await tool.execute({ query: "CODE=9528" });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('<Memory id="abcdef" tags="identifier">');
    expect(result.output).toContain("CODE=9528 is a remembered identifier.");
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

describe("traverseMemoryTool", () => {
  test("returns placeholder when no memory service", async () => {
    const result = await traverse.execute({ startId: "test" });
    expect(result.ok).toBe(true);
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
