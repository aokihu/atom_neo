import { describe, expect, test } from "bun:test";
import { GatewayBusyError, GatewayRejectedError, submitInbound } from "./gateway-client";

const base = {
  gatewayUrl: "http://gateway.test",
  secret: "gateway-secret",
  platformUserId: "12345",
  text: "hello",
};

async function capture(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (err: unknown) => err,
  );
}

describe("submitInbound", () => {
  test("posts the inbound payload and returns a 2xx response", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;

    const res = await submitInbound({
      ...base,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        captured = { url: String(url), init };
        return Response.json({ ok: true });
      }) as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect(captured?.url).toBe("http://gateway.test/gateway/inbound");
    expect(captured?.init?.method).toBe("POST");

    const headers = new Headers(captured?.init?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Gateway-Secret")).toBe("gateway-secret");
    expect(JSON.parse(String(captured?.init?.body))).toEqual({
      type: "message",
      platform: "telegram",
      platformUserId: "12345",
      data: { text: "hello" },
    });
  });

  test("throws GatewayRejectedError for a non-2xx, non-busy response", async () => {
    const err = await capture(
      submitInbound({
        ...base,
        fetchImpl: (async () => new Response("bad request", { status: 400 })) as unknown as typeof fetch,
      }),
    );

    expect(err).toBeInstanceOf(GatewayRejectedError);
    if (err instanceof GatewayRejectedError) expect(err.status).toBe(400);
  });

  test("throws GatewayBusyError with the default delay for 429", async () => {
    const err = await capture(
      submitInbound({
        ...base,
        fetchImpl: (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch,
      }),
    );

    expect(err).toBeInstanceOf(GatewayBusyError);
    if (err instanceof GatewayBusyError) {
      expect(err.status).toBe(429);
      expect(err.retryAfterMs).toBe(2_000);
    }
  });

  test("uses Retry-After seconds for 429", async () => {
    const err = await capture(
      submitInbound({
        ...base,
        fetchImpl: (async () =>
          new Response("rate limited", { status: 429, headers: { "Retry-After": "3" } })) as unknown as typeof fetch,
      }),
    );

    expect(err).toBeInstanceOf(GatewayBusyError);
    if (err instanceof GatewayBusyError) expect(err.retryAfterMs).toBe(3_000);
  });

  test("throws GatewayBusyError with the default delay for 503", async () => {
    const err = await capture(
      submitInbound({
        ...base,
        fetchImpl: (async () => new Response("not ready", { status: 503 })) as unknown as typeof fetch,
      }),
    );

    expect(err).toBeInstanceOf(GatewayBusyError);
    if (err instanceof GatewayBusyError) {
      expect(err.status).toBe(503);
      expect(err.retryAfterMs).toBe(1_000);
    }
  });

  test("propagates network errors", async () => {
    const networkError = new Error("ECONNREFUSED");
    const err = await capture(
      submitInbound({
        ...base,
        fetchImpl: (async () => {
          throw networkError;
        }) as unknown as typeof fetch,
      }),
    );

    expect(err).toBe(networkError);
  });
});
