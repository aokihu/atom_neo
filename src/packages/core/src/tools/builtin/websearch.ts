import { z } from "zod";
import type { NetworkServiceLike, ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";
import { toolResult } from "../outcome";

const callCounts = new Map<string, number>();

export function resetWebSearchCounts(): void {
  callCounts.clear();
}

type Engine = {
  name: string;
  label: string;
  url(query: string, page: number): string;
};

const ENGINES: Engine[] = [
  {
    name: "bing", label: "Bing",
    url: (q, p) => `https://cn.bing.com/search?q=${encodeURIComponent(q)}&first=${(p - 1) * 10 + 1}`,
  },
  {
    name: "google", label: "Google",
    url: (q, p) => `https://www.google.com/search?q=${encodeURIComponent(q)}&start=${(p - 1) * 10}`,
  },
  {
    name: "duckduckgo", label: "DuckDuckGo",
    url: (q, p) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}&s=${(p - 1) * 30}`,
  },
  {
    name: "brave", label: "Brave",
    url: (q, p) => `https://search.brave.com/search?q=${encodeURIComponent(q)}&offset=${(p - 1) * 20}`,
  },
];

const ENGINE_NAMES = ENGINES.map(e => e.name) as [string, ...string[]];

const WebSearchInputSchema = z.object({
  query: z.string().describe("Search query string"),
  engine: z.enum(ENGINE_NAMES).optional().default("brave").describe("Search engine. Defaults to Brave."),
  page: z.number().optional().default(1).describe("Page number for pagination (only effective when engine is specified)"),
  timeout: z.number().optional().default(15000),
  isMobile: z.boolean().optional().default(false),
});

function guidanceForCall(call: number): string {
  if (call <= 3) return "";
  if (call <= 6) return "\n[提示] 已搜索多次。如结果仍不理想，请尝试调整更精准的关键词。";
  return "\n[提示] 已进行大量搜索。请检查已有结果是否足够回答用户问题；避免重复无效搜索。";
}

function buildUrl(engine: Engine, query: string, page: number): string {
  return engine.url(query, Math.max(1, page));
}

async function fetchOne(
  network: NetworkServiceLike,
  engine: Engine,
  query: string,
  page: number,
  timeout: number,
  isMobile: boolean,
  options: any,
): Promise<string> {
  try {
    const result = await network.webFetch(
      { url: buildUrl(engine, query, page), method: "GET", headers: {}, timeoutMs: timeout, stripHtml: true, isMobile },
      { abortSignal: options?.abortSignal, sessionId: options?.sessionId },
    );
    if (!result.ok) return `[来源: ${engine.label}] 请求失败: ${result.error ?? "未知错误"}`;

    const text = result.content.trim();
    if (!text) return "";

    return `[来源: ${engine.label}]\n${text}`;
  } catch (err: any) {
    return `[来源: ${engine.label}] 错误: ${err?.message ?? String(err)}`;
  }
}

export function createWebSearchTool(network: NetworkServiceLike): ToolDefinition {
  return {
    name: "websearch",
    description: "Search the web via Brave, Bing, Google, or DuckDuckGo. Specify engine to switch, page to browse further results. Defaults to Brave.",
    source: "builtin",
    inputSchema: WebSearchInputSchema,
    execute: async (args, options) => {
      const parsed = WebSearchInputSchema.safeParse(args);
      if (!parsed.success) return toolResult.failure(parsed.error.message);

      const { query, engine, page, timeout, isMobile } = parsed.data;

      const sessionId = options?.sessionId ?? "default";
      callCounts.set(sessionId, (callCounts.get(sessionId) ?? 0) + 1);
      const call = callCounts.get(sessionId)!;

      const target = ENGINES.find(e => e.name === engine)!;
      const result = await fetchOne(network, target, query, page, timeout, isMobile, options);
      return result.trim()
        ? toolResult.evidence(result + guidanceForCall(call))
        : toolResult.none();
    },
    permission: PermissionLevel.READ_ONLY,
  };
}
