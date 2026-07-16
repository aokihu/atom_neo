import { describe, test, expect } from "bun:test";
import { substringWellFormed, truncate, slugify } from "./string";

describe("substringWellFormed", () => {
  test("repairs a surrogate pair split at either boundary", () => {
    expect(substringWellFormed("A😀B", 0, 2)).toBe("A�");
    expect(substringWellFormed("A😀B", 2)).toBe("�B");
  });

  test("preserves literal escapes and complete surrogate pairs", () => {
    expect(substringWellFormed(String.raw`C:\users\alice \u12`, 0)).toBe(String.raw`C:\users\alice \u12`);
    expect(substringWellFormed("A😀B", 0, 3)).toBe("A😀");
  });
});

describe("truncate", () => {
  test("returns string unchanged when shorter than limit", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });

  test("truncates and appends ellipsis when longer than limit", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  test("keeps truncated Unicode well formed", () => {
    expect(substringWellFormed("a😀b", 0, 2).isWellFormed()).toBe(true);
    expect(truncate("a😀b", 5).isWellFormed()).toBe(true);
  });
});

describe("slugify", () => {
  test("converts text to lowercase slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("removes special characters", () => {
    expect(slugify("Hello! @World")).toBe("hello-world");
  });
});
