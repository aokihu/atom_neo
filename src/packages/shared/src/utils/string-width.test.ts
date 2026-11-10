import { describe, expect, test } from "bun:test";
import { stringWidth } from "./string-width";

describe("stringWidth", () => {
  test("counts ASCII text", () => {
    expect(stringWidth("")).toBe(0);
    expect(stringWidth("abc")).toBe(3);
  });

  test("counts CJK characters as double width", () => {
    expect(stringWidth("中文")).toBe(4);
  });

  test("keeps emoji and combining marks at their display width", () => {
    expect(stringWidth("⚡")).toBe(2);
    expect(stringWidth("🇨🇳")).toBe(2);
    expect(stringWidth("👨‍👩‍👧‍👦")).toBe(2);
    expect(stringWidth("e\u0301")).toBe(1);
  });

  test("ignores ANSI escape sequences", () => {
    expect(stringWidth("\x1b[31mred\x1b[0m")).toBe(3);
  });
});
