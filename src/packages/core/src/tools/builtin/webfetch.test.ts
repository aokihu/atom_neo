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
      content: "page",
      metadata: { ok: true, effect: "evidence" },
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
      content: "mobile page",
      metadata: { ok: true, effect: "evidence" },
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

    expect(result.metadata.ok).toBe(false);
    expect(called).toBe(false);
  });

  test("maps an empty successful response to no progress", async () => {
    const tool = createWebFetchTool({
      webFetch: async () => ({ ok: true, code: "success", content: "" }),
    });

    expect(await tool.execute({ url: "https://example.com" })).toMatchObject({
      metadata: { ok: true, effect: "none" },
    });
  });

  test("projects only relevant HTML excerpts using the task query", async () => {
    const tool = createWebFetchTool({
      webFetch: async () => ({
        ok: true,
        code: "success",
        content: `${"navigation ".repeat(2_000)}浙江大学紫金港校区设有游泳馆和游泳池。${"footer ".repeat(2_000)}`,
        contentType: "text/html",
      }),
    });

    const result = await tool.execute(
      { url: "https://example.com/zju", stripHtml: true },
      { evidenceQuery: "浙江大学 游泳馆" },
    );

    expect(String(result.content)).toContain("浙江大学紫金港校区设有游泳馆");
    expect(String(result.content).length).toBeLessThan(16_385);
    expect(result.metadata).toEqual({ ok: true, effect: "evidence" });
  });

  test("rejects HTML that only mentions part of the requested subject", async () => {
    const tool = createWebFetchTool({
      webFetch: async () => ({
        ok: true,
        code: "success",
        content: "浙江大学历史、院系和校区介绍。",
        contentType: "text/html",
      }),
    });

    const result = await tool.execute(
      { url: "https://example.com/zju", stripHtml: true },
      { evidenceQuery: "浙江大学 游泳馆" },
    );

    expect(result.content).toBeUndefined();
    expect(result.metadata).toEqual({ ok: true, effect: "none" });
  });

  test("prefers a search URL query over an abbreviated task query", async () => {
    const tool = createWebFetchTool({
      webFetch: async () => ({
        ok: true,
        code: "success",
        content: "浙江工业大学朝晖校区游泳馆设有标准泳池。",
        contentType: "text/html",
      }),
    });

    const result = await tool.execute(
      { url: "https://www.baidu.com/s?wd=浙江工业大学+游泳馆", stripHtml: true },
      { evidenceQuery: "浙工大游泳馆" },
    );

    expect(String(result.content)).toContain("浙江工业大学朝晖校区游泳馆");
    expect(result.metadata).toEqual({ ok: true, effect: "evidence" });
  });

  test("maps a domain cooldown to an explicit no-progress outcome", async () => {
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
      metadata: {
        ok: false,
        effect: "none",
        error: "WEBFETCH_DOMAIN_COOLDOWN [google.com]: retry after 60s",
      },
    });
  });
});
