import { describe, expect, test } from "bun:test";
import { createId } from "./id";

describe("createId", () => {
  test("keeps the prefix-Date.now-counter format", () => {
    const before = Date.now();
    const id = createId("task");
    const match = /^task-(\d+)-(\d+)$/.exec(id);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(before);
    expect(Number(match![1])).toBeLessThanOrEqual(Date.now());
    expect(Number.isInteger(Number(match![2]))).toBe(true);
  });

  test("increments the counter for ids created in the same millisecond", () => {
    const first = createId("hook");
    const second = createId("hook");
    if (first.split("-")[1] === second.split("-")[1]) {
      expect(Number(second.split("-")[2])).toBe(Number(first.split("-")[2]) + 1);
    }
    expect(first).not.toBe(second);
  });

  test("supports multi-part prefixes", () => {
    expect(createId("shell-job")).toMatch(/^shell-job-\d+-\d+$/);
  });
});
