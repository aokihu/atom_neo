import { describe, expect, test, beforeEach } from "bun:test";
import type { NetworkServiceLike } from "@atom-neo/shared";
import { createWebSearchTool, resetWebSearchCounts } from "./websearch";

function stubNetwork(responses?: Record<string, string>) {
  const network: NetworkServiceLike = {
    webFetch: async (request: any) => ({
      ok: true,
      code: "success",
      content: responses?.[request.url] ?? `page: ${request.url}`,
      httpStatus: 200,
      contentType: "text/plain",
      rateLimit: { domain: new URL(request.url).hostname, waitedMs: 0 },
    }),
  };
  return network;
}

describe("websearch builtin tool", () => {
  beforeEach(() => resetWebSearchCounts());

  test("defaults to Brave engine", async () => {
    const network = stubNetwork();
    const tool = createWebSearchTool(network);

    const r = await tool.execute({ query: "test" }, { sessionId: "s1" });

    expect(r.content).toContain("[来源: Brave]");
    expect(r.content).not.toContain("[来源: Bing]");
    expect(r.content).not.toContain("[来源: Google]");
  });

  test("can switch to specific engine", async () => {
    const network = stubNetwork();
    const tool = createWebSearchTool(network);

    const r = await tool.execute({ query: "test", engine: "bing" }, { sessionId: "s1" });

    expect(r.content).toContain("[来源: Bing]");
    expect(r.content).not.toContain("[来源: Brave]");
  });

  test("supports pagination via page parameter", async () => {
    const network = stubNetwork();
    const tool = createWebSearchTool(network);

    const r = await tool.execute({ query: "test", page: 3 }, { sessionId: "s1" });
    expect(r.content).toContain("offset=40");
  });

  test("returns evidence effect with content", async () => {
    const network = stubNetwork();
    const tool = createWebSearchTool(network);

    const r = await tool.execute({ query: "test" }, { sessionId: "s1" });
    expect(r.metadata.ok).toBe(true);
    expect(r.metadata.effect).toBe("evidence");
  });

  test("injects guidance from call 4", async () => {
    const network = stubNetwork();
    const tool = createWebSearchTool(network);

    for (let i = 0; i < 3; i++) {
      await tool.execute({ query: `q${i}` }, { sessionId: "s1" });
    }

    const r = await tool.execute({ query: "q4" }, { sessionId: "s1" });
    expect(r.content).toContain("已搜索多次");
  });
});
