import { describe, test, expect } from "bun:test";
import { truncate, slugify } from "./string";

describe("truncate", () => {
  test("returns string unchanged when shorter than limit", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });

  test("truncates and appends ellipsis when longer than limit", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
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
