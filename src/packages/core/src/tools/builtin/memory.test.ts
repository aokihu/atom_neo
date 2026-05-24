import { describe, test, expect } from "bun:test";
import { createSearchMemoryTool, createSaveMemoryTool, createTraverseMemoryTool, createLinkMemoryTool } from "./memory";

const search = createSearchMemoryTool();
const save = createSaveMemoryTool();
const traverse = createTraverseMemoryTool();
const link = createLinkMemoryTool();

describe("saveMemoryTool", () => {
  test("returns ok stub when no memory service", async () => {
    const result = await save.execute({ content: "test memory", tags: ["test"] });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("memory service not connected");
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
