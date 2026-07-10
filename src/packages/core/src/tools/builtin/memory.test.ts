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
});

describe("traverseMemoryTool", () => {
  test("returns placeholder when no memory service", async () => {
    const result = await traverse.execute({ startKey: "test" });
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

  test("forgets memory by ID", async () => {
    const tool = createForgetMemoryTool({
      forget: () => true,
    });

    const result = await tool.execute({ id: "abc123" });

    expect(result.ok).toBe(true);
    expect(result.output).toBe("Forgot memory: abc123");
  });
});
