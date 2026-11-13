/** Restart policy backoff and reset tests. */
import { describe, expect, test } from "bun:test";
import { RestartPolicy } from "./restart-policy";

describe("RestartPolicy", () => {
  test("backs off 1s, 2s, 4s, 8s, 16s and then gives up", () => {
    const policy = new RestartPolicy();
    expect(Array.from({ length: 5 }, () => policy.next())).toEqual([
      { action: "restart", attempt: 1, delayMs: 1_000 },
      { action: "restart", attempt: 2, delayMs: 2_000 },
      { action: "restart", attempt: 3, delayMs: 4_000 },
      { action: "restart", attempt: 4, delayMs: 8_000 },
      { action: "restart", attempt: 5, delayMs: 16_000 },
    ]);
    expect(policy.next()).toEqual({ action: "give_up", attempts: 5 });
    expect(policy.next()).toEqual({ action: "give_up", attempts: 5 });
  });

  test("caps the delay at 30s", () => {
    const policy = new RestartPolicy({ maxAttempts: 10 });
    const delays = Array.from({ length: 7 }, () => policy.next());
    expect(delays.at(-2)).toEqual({ action: "restart", attempt: 6, delayMs: 30_000 });
    expect(delays.at(-1)).toEqual({ action: "restart", attempt: 7, delayMs: 30_000 });
  });

  test("resets attempts after a healthy period", () => {
    const policy = new RestartPolicy();
    policy.next();
    policy.next();
    expect(policy.attempts).toBe(2);
    policy.reset();
    expect(policy.attempts).toBe(0);
    expect(policy.next()).toEqual({ action: "restart", attempt: 1, delayMs: 1_000 });
  });
});
