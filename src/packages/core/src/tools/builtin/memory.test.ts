import { describe, test, expect } from "bun:test";
import { createSearchMemoryTool, createSaveMemoryTool, createTraverseMemoryTool, createLinkMemoryTool } from "./memory";

const search = createSearchMemoryTool();
const save = createSaveMemoryTool();
const traverse = createTraverseMemoryTool();
const link = createLinkMemoryTool();

describe("saveMemoryTool", () => {
  test("returns ok with data", async () => {
    const result = await save.execute({ key: "test.key", type: "fact", content: "test", category: "test" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("test.key");
  });
});

describe("searchMemoryTool", () => {
  test("returns placeholder", async () => {
    const result = await search.execute({ query: "test" });
    expect(result.ok).toBe(true);
  });
});

describe("traverseMemoryTool", () => {
  test("returns placeholder", async () => {
    const result = await traverse.execute({ goal: "find" });
    expect(result.ok).toBe(true);
  });
});

describe("linkMemoryTool", () => {
  test("returns ok", async () => {
    const result = await link.execute({ sourceKey: "a", targetKey: "b", relation: "depends_on" });
    expect(result.ok).toBe(true);
  });
});
