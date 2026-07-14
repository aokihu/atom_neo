import { describe, expect, test } from "bun:test";
import { sanitizeForJSON } from "./sanitize";

describe("sanitizeForJSON", () => {
  test("repairs lone surrogates", () => {
    expect(sanitizeForJSON("broken \uD800 text")).toBe("broken � text");
  });

  test("preserves literal escapes and paths", () => {
    const text = String.raw`Windows C:\users\alice; regex /\u4e00-\u9fff/; literal \u12`;

    expect(sanitizeForJSON(text)).toBe(text);
  });
});
