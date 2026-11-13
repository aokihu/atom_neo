/** Health probe result normalization tests. */
import { describe, expect, test } from "bun:test";
import { HealthProbe } from "./health-probe";
import { FakeClock } from "./test-helpers";

describe("HealthProbe", () => {
  test("returns healthy for a 2xx response", async () => {
    const clock = new FakeClock();
    const probe = new HealthProbe({
      fetch: async () => new Response("ok", { status: 200 }),
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      timeoutMs: 100,
    });
    expect(await probe.check("http://client/health")).toEqual({ healthy: true });
  });

  test("returns unhealthy with status for a non-2xx response", async () => {
    const clock = new FakeClock();
    const probe = new HealthProbe({
      fetch: async () => new Response("nope", { status: 503 }),
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      timeoutMs: 100,
    });
    expect(await probe.check("http://client/health")).toEqual({ healthy: false, reason: "status", status: 503 });
  });

  test("returns unhealthy for network errors", async () => {
    const clock = new FakeClock();
    const probe = new HealthProbe({
      fetch: async () => { throw new Error("ECONNREFUSED"); },
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      timeoutMs: 100,
    });
    expect(await probe.check("http://client/health")).toEqual({ healthy: false, reason: "network" });
  });

  test("returns unhealthy when the request times out", async () => {
    const clock = new FakeClock();
    let signal: AbortSignal | undefined;
    const probe = new HealthProbe({
      fetch: (_url, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      },
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      timeoutMs: 250,
    });

    const pending = probe.check("http://client/health");
    await clock.advance(250);
    expect(await pending).toEqual({ healthy: false, reason: "timeout" });
    expect(signal?.aborted).toBe(true);
    expect(clock.pendingTimers).toBe(0);
  });
});
