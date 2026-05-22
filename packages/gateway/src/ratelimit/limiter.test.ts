import { describe, test, expect } from "bun:test";
import { RateLimiter } from "./limiter";

describe("RateLimiter", () => {
  test("allows first request", () => {
    const rl = new RateLimiter({ maxRequests: 10, burst: 2 });
    expect(rl.allow("key1")).toBe(true);
  });

  test("allows burst above maxRequests", () => {
    const rl = new RateLimiter({ maxRequests: 2, burst: 2 });
    expect(rl.allow("key1")).toBe(true);
    expect(rl.allow("key1")).toBe(true);
    expect(rl.allow("key1")).toBe(true);
    expect(rl.allow("key1")).toBe(true); // 4 = 2 max + 2 burst
    expect(rl.allow("key1")).toBe(false); // blocked
  });

  test("resets key", () => {
    const rl = new RateLimiter({ maxRequests: 1, burst: 0 });
    rl.allow("key1");
    expect(rl.allow("key1")).toBe(false);
    rl.reset("key1");
    expect(rl.allow("key1")).toBe(true);
  });

  test("separates by key", () => {
    const rl = new RateLimiter({ maxRequests: 1, burst: 0 });
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("b")).toBe(true);
    expect(rl.allow("a")).toBe(false);
    expect(rl.allow("b")).toBe(false);
  });
});
