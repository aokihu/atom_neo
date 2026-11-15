/** Diagnostics history bounds and optional Client `/diagnostics` protocol tests. */
import { describe, expect, test } from "bun:test";
import { DiagnosticsStore, readClientDiagnostics } from "./diagnostics";

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function fakeFetch(handler: FetchHandler): typeof fetch {
  return Object.assign(
    (input: string | URL | Request, init?: RequestInit) => handler(String(input), init),
    { preconnect: () => {} },
  );
}

const client = { id: "telegram", url: "http://127.0.0.1:7001" };

describe("DiagnosticsStore", () => {
  test("orders events and keeps only the newest 50", () => {
    const store = new DiagnosticsStore();
    for (let i = 0; i < 55; i++) {
      store.record("a", { stage: "process", level: "info", message: `event-${i}` });
    }

    const events = store.list("a");
    expect(events).toHaveLength(50);
    expect(events.map((event) => event.message)).toEqual(
      Array.from({ length: 50 }, (_, index) => `event-${index + 5}`),
    );
    expect(store.summary("a").map((event) => event.message)).toEqual([
      "event-50",
      "event-51",
      "event-52",
      "event-53",
      "event-54",
    ]);
    expect(store.summary("a", 2).map((event) => event.message)).toEqual(["event-53", "event-54"]);
    expect(store.summary("a", 100)).toHaveLength(50);
  });

  test("isolates instances and removes only one history", () => {
    const store = new DiagnosticsStore();
    store.record("a", { stage: "install", level: "info", message: "a" });
    store.record("b", { stage: "config", level: "warn", message: "b" });

    expect(store.list("a").map((event) => event.message)).toEqual(["a"]);
    expect(store.list("b").map((event) => event.message)).toEqual(["b"]);

    store.remove("a");
    expect(store.list("a")).toEqual([]);
    expect(store.summary("a")).toEqual([]);
    expect(store.list("b").map((event) => event.message)).toEqual(["b"]);

    store.record("a", { stage: "process", level: "info", message: "again" });
    expect(store.list("a").map((event) => event.message)).toEqual(["again"]);
  });

  test("preserves explicit timestamps and stamps missing ones with ISO", () => {
    const store = new DiagnosticsStore();
    const at = "2026-11-15T00:00:00.000Z";
    store.record("a", { stage: "delivery", level: "error", message: "explicit", at });
    store.record("a", { stage: "delivery", level: "info", message: "implicit" });

    const [explicit, implicit] = store.list("a");
    expect(explicit.at).toBe(at);
    expect(implicit.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(implicit.at).toISOString()).toBe(implicit.at);
  });
});

describe("readClientDiagnostics", () => {
  test("returns checks for a 2xx JSON response", async () => {
    const checks = [{ name: "telegram.getMe", ok: true }];
    const fetchImpl = fakeFetch(async () => new Response(JSON.stringify({ checks }), { status: 200 }));

    expect(await readClientDiagnostics(client, fetchImpl)).toEqual({ status: "ok", checks });
  });

  test("returns unsupported for 404", async () => {
    const fetchImpl = fakeFetch(async () => new Response("missing", { status: 404 }));

    expect(await readClientDiagnostics(client, fetchImpl)).toEqual({ status: "unsupported" });
  });

  test("returns unreachable for non-2xx, network errors and timeouts", async () => {
    const failing = fakeFetch(async () => new Response("boom", { status: 500 }));
    expect(await readClientDiagnostics(client, failing)).toEqual({
      status: "unreachable",
      error: "HTTP 500",
    });

    const offline = fakeFetch(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:7001?token=secret");
    });
    const network = await readClientDiagnostics(client, offline);
    expect(network.status).toBe("unreachable");
    if (network.status === "unreachable") {
      expect(network.error).toBe("Diagnostics request failed");
      expect(network.error).not.toContain("secret");
    }

    const timeout = fakeFetch(async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });
    expect(await readClientDiagnostics(client, timeout)).toEqual({
      status: "unreachable",
      error: "Diagnostics request timed out",
    });
  });

  test("returns unreachable for malformed bodies", async () => {
    for (const body of ["not json", "null", JSON.stringify({ checks: "nope" }), JSON.stringify({ ok: true })]) {
      const fetchImpl = fakeFetch(async () => new Response(body, { status: 200 }));
      const result = await readClientDiagnostics(client, fetchImpl);
      expect(result.status).toBe("unreachable");
    }
  });

  test("bounds check count and serialized size", async () => {
    const many = Array.from({ length: 25 }, (_, index) => ({ name: `check-${index}`, ok: true }));
    const bounded = await readClientDiagnostics(client, fakeFetch(async () => Response.json({ checks: many })));
    expect(bounded.status).toBe("ok");
    if (bounded.status === "ok") expect(bounded.checks).toHaveLength(20);

    const long = Array.from({ length: 20 }, (_, index) => ({
      name: `check-${index}-${"n".repeat(300)}`,
      ok: true,
      detail: `detail-${"d".repeat(300)}`,
    }));
    const sized = await readClientDiagnostics(client, fakeFetch(async () => Response.json({ checks: long })));
    expect(sized.status).toBe("ok");
    if (sized.status === "ok") {
      expect(sized.checks.length).toBeLessThan(20);
      expect(new TextEncoder().encode(JSON.stringify(sized.checks)).byteLength).toBeLessThanOrEqual(8_192);
      expect(sized.checks[0]!.name.length).toBeLessThanOrEqual(200);
      expect(sized.checks[0]!.detail!.length).toBeLessThanOrEqual(200);
    }
  });

  test("drops unknown fields, rejects invalid checks, and redacts common secrets", async () => {
    const valid = await readClientDiagnostics(client, fakeFetch(async () => Response.json({
      checks: [{
        name: "telegram.getMe",
        ok: true,
        at: "2026-11-15T00:00:00.000Z",
        detail: "token=super-secret bot123:ABC-DEF",
        arbitrary: "drop",
      }],
    })));
    expect(valid).toEqual({
      status: "ok",
      checks: [{
        name: "telegram.getMe",
        ok: true,
        at: "2026-11-15T00:00:00.000Z",
        detail: "[redacted] [redacted]",
      }],
    });
    if (valid.status === "ok") {
      expect(valid.checks[0]).not.toHaveProperty("arbitrary");
      expect(JSON.stringify(valid)).not.toContain("super-secret");
      expect(JSON.stringify(valid)).not.toContain("ABC-DEF");
    }

    for (const checks of [[{ name: "missing-ok" }], [{ ok: true }], [{ name: "", ok: true }]]) {
      const result = await readClientDiagnostics(client, fakeFetch(async () => Response.json({ checks })));
      expect(result.status).toBe("unreachable");
    }
  });

  test("requests only /diagnostics and never /health", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = fakeFetch(async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ checks: [] }), { status: 200 });
    });

    await readClientDiagnostics(client, fetchImpl);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:7001/diagnostics");
    expect(calls.some(({ url }) => url.endsWith("/health"))).toBe(false);
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });
});
