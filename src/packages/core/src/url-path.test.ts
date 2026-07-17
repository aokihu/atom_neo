import { describe, expect, test } from "bun:test";
import { decodePathParam } from "./url-path";

describe("decodePathParam", () => {
  test("decodes an encoded session ID exactly once", () => {
    const sessionId = "team/研发 100%";
    const pathname = `/ws/${encodeURIComponent(sessionId)}`;

    expect(decodePathParam(pathname, "/ws/")).toBe(sessionId);
    expect(decodePathParam("/ws/%252F", "/ws/")).toBe("%2F");
  });

  test("rejects missing, malformed, and multi-segment values", () => {
    expect(decodePathParam("/ws/", "/ws/")).toBeUndefined();
    expect(decodePathParam("/ws/%", "/ws/")).toBeUndefined();
    expect(decodePathParam("/ws/team/member", "/ws/")).toBeUndefined();
    expect(decodePathParam("/api/sessions/id", "/ws/")).toBeUndefined();
  });
});
