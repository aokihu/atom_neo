import { describe, test, expect } from "bun:test";
import { normalizeError, errorMessage } from "./error";

describe("normalizeError", () => {
  test("returns Error instance as-is", () => {
    const err = new Error("test");
    const result = normalizeError(err);
    expect(result).toBe(err);
  });

  test("wraps string into Error", () => {
    const result = normalizeError("something wrong");
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("something wrong");
  });

  test("wraps unknown value into Error", () => {
    const result = normalizeError(42);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("42");
  });
});

describe("errorMessage", () => {
  test("extracts message from Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  test("extracts message from string", () => {
    expect(errorMessage("plain error")).toBe("plain error");
  });
});
