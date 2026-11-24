import { describe, expect, test } from "bun:test";
import { stringWidth } from "@atom-neo/shared";
import { menuContentWidth, truncateByWidth, truncateMiddle } from "./menu-frame";

describe("menu header width helpers", () => {
  test("computes content width after Modal border and padding", () => {
    expect(menuContentWidth(100)).toBe(92);
    expect(menuContentWidth(64)).toBe(56);
    expect(menuContentWidth(40)).toBe(32);
  });

  test("handles empty and degenerate widths", () => {
    expect(truncateByWidth("", 0)).toBe("");
    expect(truncateByWidth("abc", 0)).toBe("");
    expect(truncateByWidth("abc", 1)).toBe("…");
    expect(truncateMiddle("/long/path", 0)).toBe("");
    expect(truncateMiddle("/long/path", 1)).toBe("…");
  });

  test("truncates CJK by display width rather than code units", () => {
    const value = "中文测试";
    expect(truncateByWidth(value, 5)).toBe("中文…");
    expect(stringWidth(truncateByWidth(value, 5))).toBeLessThanOrEqual(5);
  });

  test("keeps emoji and combining graphemes intact", () => {
    const family = "👨‍👩‍👧‍👦abc";
    const truncated = truncateByWidth(family, 4);
    expect(truncated.startsWith("👨‍👩‍👧‍👦")).toBe(true);
    expect(truncated).toContain("…");
    expect(truncated.isWellFormed()).toBe(true);
    expect(stringWidth(truncated)).toBeLessThanOrEqual(5);

    const combining = truncateByWidth("e\u0301xyz", 3);
    expect(combining.startsWith("e\u0301")).toBe(true);
    expect(combining.isWellFormed()).toBe(true);
    expect(stringWidth(combining)).toBeLessThanOrEqual(3);
  });

  test("middle truncation preserves both ends within the display width", () => {
    const path = "/项目/目录/很长的文件名.atombak";
    const truncated = truncateMiddle(path, 9);
    expect(truncated).toContain("…");
    expect(truncated.startsWith("/")).toBe(true);
    expect(truncated.endsWith("k")).toBe(true);
    expect(stringWidth(truncated)).toBeLessThanOrEqual(9);
  });
});
