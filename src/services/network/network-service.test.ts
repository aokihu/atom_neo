import { describe, expect, test } from "bun:test";
import { NetworkService } from "./network-service";

function response(body: string, init?: ResponseInit): Response {
  return new Response(body, init);
}

describe("NetworkService webFetch", () => {
  test("reserves staggered search slots across subdomains", async () => {
    const waits: number[] = [];
    const requested: string[] = [];
    const service = new NetworkService({
      now: () => 0,
      sleep: async ms => { if (ms > 0) waits.push(ms); },
      fetch: async input => {
        requested.push(String(input));
        return response("ok", { status: 200, headers: { "content-type": "text/plain" } });
      },
    });
    await service.start();

    const results = await Promise.all([
      service.webFetch({ url: "https://www.google.com/search?q=one" }),
      service.webFetch({ url: "https://news.google.com/search?q=two" }),
      service.webFetch({ url: "https://www.google.com/search?q=three" }),
    ]);

    expect(results.every(result => result.ok)).toBe(true);
    expect(requested).toHaveLength(3);
    expect(waits).toEqual([5_000, 10_000]);
    await service.stop();
  });

  test("keeps different domains independently schedulable", async () => {
    const waits: number[] = [];
    const service = new NetworkService({
      now: () => 0,
      sleep: async ms => { if (ms > 0) waits.push(ms); },
      fetch: async () => response("ok"),
    });
    await service.start();

    const results = await Promise.all([
      service.webFetch({ url: "https://example.com/a" }),
      service.webFetch({ url: "https://example.org/b" }),
    ]);

    expect(results.every(result => result.ok)).toBe(true);
    expect(waits).toEqual([]);
    await service.stop();
  });

  test("selects desktop or mobile browser User-Agents and preserves an explicit override", async () => {
    const userAgents: string[] = [];
    const randomValues = [0, 0.999];
    const service = new NetworkService({
      random: () => randomValues.shift() ?? 0,
      sleep: async () => {},
      fetch: async (_input, init) => {
        userAgents.push(new Headers(init?.headers).get("user-agent") ?? "");
        return response("ok");
      },
    });
    await service.start();

    await service.webFetch({ url: "https://desktop.example.com" });
    await service.webFetch({ url: "https://mobile.example.org", isMobile: true });
    await service.webFetch({
      url: "https://override.example.net",
      headers: { "user-agent": "CustomClient/1.0" },
    });

    expect(userAgents[0]).toContain("Chrome/150.0.0.0");
    expect(userAgents[0]).not.toContain("Mobile");
    expect(userAgents[1]).toContain("iPhone");
    expect(userAgents[1]).toContain("Mobile/15E148 Safari/604.1");
    expect(userAgents[2]).toBe("CustomClient/1.0");
    await service.stop();
  });

  test("blocks a domain after 429 and honors Retry-After seconds", async () => {
    let now = 0;
    let requestCount = 0;
    const service = new NetworkService({
      now: () => now,
      sleep: async ms => { now += ms; },
      fetch: async () => {
        requestCount++;
        return requestCount === 1
          ? response("limited", { status: 429, headers: { "retry-after": "120" } })
          : response("ok");
      },
    });
    await service.start();

    const limited = await service.webFetch({ url: "https://www.google.com/search?q=one" });
    const blocked = await service.webFetch({ url: "https://news.google.com/search?q=two" });

    expect(limited).toMatchObject({
      ok: false,
      code: "http_error",
      rateLimit: { domain: "google.com", cooldownMs: 120_000 },
    });
    expect(blocked).toMatchObject({
      ok: false,
      code: "domain_cooldown",
      rateLimit: { domain: "google.com", retryAfterMs: 120_000 },
    });
    expect(requestCount).toBe(1);

    now += 120_000;
    expect(await service.webFetch({ url: "https://google.com/search?q=three" })).toMatchObject({ ok: true });
    expect(requestCount).toBe(2);
    await service.stop();
  });

  test("honors an HTTP-date Retry-After longer than the default cooldown", async () => {
    const now = Date.parse("2026-07-21T00:00:00Z");
    const service = new NetworkService({
      now: () => now,
      sleep: async () => {},
      fetch: async () => response("limited", {
        status: 429,
        headers: { "retry-after": "Tue, 21 Jul 2026 00:02:00 GMT" },
      }),
    });
    await service.start();

    expect(await service.webFetch({ url: "https://search.bing.com/search?q=one" })).toMatchObject({
      rateLimit: { domain: "bing.com", cooldownMs: 120_000 },
    });
    await service.stop();
  });

  test("uses the default 60 second cooldown without Retry-After", async () => {
    const service = new NetworkService({
      now: () => 0,
      sleep: async () => {},
      fetch: async () => response("limited", { status: 429 }),
    });
    await service.start();

    expect(await service.webFetch({ url: "https://search.bing.com/search?q=one" })).toMatchObject({
      rateLimit: { domain: "bing.com", cooldownMs: 60_000 },
    });
    await service.stop();
  });

  test("does not fetch when the task was already aborted", async () => {
    let requestCount = 0;
    const abortController = new AbortController();
    abortController.abort();
    const service = new NetworkService({
      fetch: async () => {
        requestCount++;
        return response("unexpected");
      },
    });
    await service.start();

    const result = await service.webFetch(
      { url: "https://example.com" },
      { abortSignal: abortController.signal },
    );

    expect(result).toMatchObject({ ok: false, code: "cancelled", error: "Request cancelled" });
    expect(requestCount).toBe(0);
    await service.stop();
  });

  test("distinguishes request timeout from task cancellation", async () => {
    const service = new NetworkService({
      fetch: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    });
    await service.start();

    expect(await service.webFetch({ url: "https://example.com", timeoutMs: 1 })).toMatchObject({
      ok: false,
      code: "timeout",
      error: "Request timed out after 1ms",
    });
    await service.stop();
  });

  test("stop cancels a queued request and rejects new work", async () => {
    let requestCount = 0;
    const service = new NetworkService({
      now: () => 0,
      sleep: (ms, signal) => ms <= 0
        ? Promise.resolve()
        : new Promise((_, reject) => signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          )),
      fetch: async () => {
        requestCount++;
        return response("ok");
      },
    });
    await service.start();
    await service.webFetch({ url: "https://google.com/search?q=one" });
    const queued = service.webFetch({ url: "https://google.com/search?q=two" });

    await service.stop();

    expect(await queued).toMatchObject({ ok: false, code: "cancelled" });
    expect(requestCount).toBe(1);
    expect(await service.webFetch({ url: "https://example.com" })).toMatchObject({
      ok: false,
      code: "network_error",
      error: "Network service is not running",
    });
  });

  test("validates URLs and strips HTML inside the WebFetch subfunction", async () => {
    const service = new NetworkService({
      fetch: async () => response("<html><head><title>x</title></head><body>Hello <b>world</b></body></html>", {
        headers: { "content-type": "text/html" },
      }),
    });
    await service.start();

    expect(await service.webFetch({ url: "file:///tmp/data" })).toMatchObject({
      ok: false,
      code: "invalid_url",
    });
    expect(await service.webFetch({ url: "https://example.com" })).toMatchObject({
      ok: true,
      content: "Hello world",
      contentType: "text/html",
    });
    await service.stop();
  });
});
