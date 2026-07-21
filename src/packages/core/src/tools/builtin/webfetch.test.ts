import { describe, expect, test } from "bun:test";
import type { NetworkServiceLike } from "@atom-neo/shared";
import { createWebFetchTool } from "./webfetch";

describe("webfetch tool adapter", () => {
  test("passes validated input and execution context to NetworkService", async () => {
    const calls: Array<{ request: any; options: any }> = [];
    const network: NetworkServiceLike = {
      webFetch: async (request, options) => {
        calls.push({ request, options });
        return {
          ok: true,
          code: "success",
          content: "page",
          httpStatus: 200,
          contentType: "text/plain",
          rateLimit: { domain: "example.com", waitedMs: 1_000 },
        };
      },
    };
    const abortController = new AbortController();
    const tool = createWebFetchTool(network);

    const result = await tool.execute(
      { url: "https://example.com", timeout: 2_000 },
      { abortSignal: abortController.signal, sessionId: "session-1" },
    );

    expect(calls).toEqual([{
      request: {
        url: "https://example.com",
        method: "GET",
        headers: {},
        isMobile: false,
        timeoutMs: 2_000,
        stripHtml: true,
      },
      options: { abortSignal: abortController.signal, sessionId: "session-1" },
    }]);
    expect(result).toEqual({
      ok: true,
      output: "page",
      data: {
        status: 200,
        contentType: "text/plain",
        rateLimit: { domain: "example.com", waitedMs: 1_000 },
      },
    });
  });

  test("passes the requested mobile profile without exposing a raw User-Agent", async () => {
    const requests: any[] = [];
    const tool = createWebFetchTool({
      webFetch: async request => {
        requests.push(request);
        return { ok: true, code: "success", content: "mobile page" };
      },
    });

    expect(await tool.execute({ url: "https://example.com", isMobile: true })).toMatchObject({
      ok: true,
      output: "mobile page",
    });
    expect(requests).toEqual([expect.objectContaining({ isMobile: true })]);
  });

  test("does not call NetworkService when the schema is invalid", async () => {
    let called = false;
    const tool = createWebFetchTool({
      webFetch: async () => {
        called = true;
        return { ok: true, code: "success", content: "unexpected" };
      },
    });

    const result = await tool.execute({ url: 123 });

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  test("maps a domain cooldown without changing the Tool contract", async () => {
    const tool = createWebFetchTool({
      webFetch: async () => ({
        ok: false,
        code: "domain_cooldown",
        content: "",
        error: "WEBFETCH_DOMAIN_COOLDOWN [google.com]: retry after 60s",
        httpStatus: 429,
        rateLimit: { domain: "google.com", waitedMs: 0, retryAfterMs: 60_000 },
      }),
    });

    expect(await tool.execute({ url: "https://google.com" })).toEqual({
      ok: false,
      output: "",
      error: "WEBFETCH_DOMAIN_COOLDOWN [google.com]: retry after 60s",
      data: {
        status: 429,
        rateLimit: { domain: "google.com", waitedMs: 0, retryAfterMs: 60_000 },
      },
    });
  });
});
