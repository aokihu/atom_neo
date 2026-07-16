import { describe, expect, test } from "bun:test";
import { isDoubleEscape } from "./InputBar";

describe("InputBar cancel shortcut", () => {
  test("requires two ESC presses inside the confirmation window", () => {
    expect(isDoubleEscape(0, 1_000)).toBe(false);
    expect(isDoubleEscape(1_000, 2_999)).toBe(true);
    expect(isDoubleEscape(1_000, 3_000)).toBe(false);
  });
});
