import { describe, test, expect } from "bun:test";
import { searchMemoryTool, saveMemoryTool, traverseMemoryTool, linkMemoryTool } from "./memory";

describe("saveMemoryTool", () => {
  test("returns ok with data", async () => {
    const result = await saveMemoryTool.execute({
      key: "test.key",
      type: "fact",
      content: "test content",
      category: "test",
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("test.key");
  });

  test("rejects invalid input", async () => {
    const result = await saveMemoryTool.execute({ key: 123 });
    expect(result.ok).toBe(false);
  });
});

describe("searchMemoryTool", () => {
  test("returns placeholder when service not connected", async () => {
    const result = await searchMemoryTool.execute({ query: "test" });
    expect(result.ok).toBe(true);
  });
});

describe("traverseMemoryTool", () => {
  test("returns placeholder paths", async () => {
    const result = await traverseMemoryTool.execute({ goal: "find" });
    expect(result.ok).toBe(true);
  });
});

describe("linkMemoryTool", () => {
  test("returns ok with link data", async () => {
    const result = await linkMemoryTool.execute({
      sourceKey: "a",
      targetKey: "b",
      relation: "depends_on",
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("a");
    expect(result.output).toContain("b");
  });

  test("rejects missing fields", async () => {
    const result = await linkMemoryTool.execute({ sourceKey: "a" });
    expect(result.ok).toBe(false);
  });
});
