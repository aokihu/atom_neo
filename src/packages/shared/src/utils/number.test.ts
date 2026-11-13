import { describe, expect, test } from "bun:test";
import { clamp, parsePortValue } from "./number";

describe("clamp", () => {
  test("bounds values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("parsePortValue", () => {
  test("parses valid ports and trims whitespace", () => {
    expect(parsePortValue("3000")).toBe(3000);
    expect(parsePortValue(" 1 ")).toBe(1);
    expect(parsePortValue("65535")).toBe(65535);
  });

  test("honours allowZero", () => {
    expect(parsePortValue("0")).toBeUndefined();
    expect(parsePortValue("0", { allowZero: true })).toBe(0);
  });

  test("rejects invalid input", () => {
    for (const value of ["", "  ", "65536", "-1", "1.5", "abc", "1e3", "0x10"]) {
      expect(parsePortValue(value)).toBeUndefined();
    }
  });
});
