import { describe, expect, test } from "bun:test";
import { areMemorySearchQueriesSimilar, canonicalizeMemorySearchQuery, parseMemorySearchTerms } from "./memory-search";

describe("Memory search query parsing", () => {
  test("removes dates and freshness words when a concept is present", () => {
    expect(parseMemorySearchTerms("台风 最新 2026")).toEqual(["台风"]);
    expect(parseMemorySearchTerms("2026")).toEqual(["2026"]);
  });

  test("adds partial terms for an unsegmented Chinese query", () => {
    expect(parseMemorySearchTerms("查询一下台风最新动向")).toContain("台风");
  });

  test("treats reordered or freshness-only changes as the same query", () => {
    expect(canonicalizeMemorySearchQuery("台风 最新 2026")).toBe("台风");
    expect(canonicalizeMemorySearchQuery("latest typhoon")).toBe("typhoon");
    expect(canonicalizeMemorySearchQuery("typhoon latest")).toBe("typhoon");
  });

  test("treats overlapping keywords and Chinese fragments as similar", () => {
    expect(areMemorySearchQueriesSimilar("台风", "台风查询技能")).toBe(true);
    expect(areMemorySearchQueriesSimilar("typhoon skill", "latest typhoon method")).toBe(true);
    expect(areMemorySearchQueriesSimilar("台风", "热带气旋 typhoon")).toBe(false);
  });
});
