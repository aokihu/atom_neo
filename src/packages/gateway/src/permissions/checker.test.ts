import { describe, test, expect } from "bun:test";
import { checkPermission } from "./checker";

describe("checkPermission", () => {
  test("grants when level is sufficient", () => {
    expect(checkPermission(0, 0)).toBe(true);
    expect(checkPermission(1, 2)).toBe(true);
  });

  test("denies when level is insufficient", () => {
    expect(checkPermission(2, 1)).toBe(false);
  });
});
