import { z } from "zod";
import type { NetworkServiceLike, ToolDefinition } from "@atom-neo/shared";
import { parseMemorySearchTerms, PermissionLevel } from "@atom-neo/shared";
import { toolResult } from "../outcome";

const HTML_EVIDENCE_LIMIT = 16_384;
const HTML_EVIDENCE_WINDOW = 800;
const MIN_EVIDENCE_COVERAGE = 0.6;

const SEARCH_ENGINE_HOSTS = new Set([
  "bing.com", "cn.bing.com", "www.bing.com",
  "google.com", "www.google.com",
  "baidu.com", "www.baidu.com",
]);

function isSearchEngine(urlString: string): boolean {
  try {
    return SEARCH_ENGINE_HOSTS.has(new URL(urlString).hostname);
  } catch {
    return false;
  }
}

export function extractWebEvidence(content: string, query: string) {
  const source = content.trim();
  const terms = parseMemorySearchTerms(query).filter(term => Array.from(term).length >= 2);
  if (!source || terms.length === 0) {
    return {
      content: source.slice(0, HTML_EVIDENCE_LIMIT),
      matchedTerms: [] as string[],
      totalTerms: terms.length,
      coverage: source ? 1 : 0,
    };
  }

  const lower = source.toLowerCase();
  const matchedTerms = terms.filter(term => lower.includes(term.toLowerCase()));
  const coverage = matchedTerms.length / terms.length;
  if (coverage < MIN_EVIDENCE_COVERAGE) {
    return { content: "", matchedTerms, totalTerms: terms.length, coverage };
  }

  const ranges = matchedTerms
    .map(term => lower.indexOf(term.toLowerCase()))
    .filter(index => index >= 0)
    .map(index => ({
      start: Math.max(0, index - HTML_EVIDENCE_WINDOW),
      end: Math.min(source.length, index + HTML_EVIDENCE_WINDOW),
    }))
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  const excerpt = merged.map(range => source.slice(range.start, range.end)).join(" … ");
  return {
    content: excerpt.slice(0, HTML_EVIDENCE_LIMIT),
    matchedTerms,
    totalTerms: terms.length,
    coverage,
  };
}

function resolveEvidenceQuery(url: string, taskQuery = ""): string {
  try {
    const target = new URL(url);
    for (const key of ["q", "wd", "query"]) {
      const value = target.searchParams.get(key)?.trim();
      if (value) return value;
    }
  } catch {
    // URL validation is handled by NetworkService.
  }
  return taskQuery.trim();
}

const WebFetchInputSchema = z.object({
  url: z.string().describe("HTTP/HTTPS URL to fetch"),
  method: z.enum(["GET", "POST"]).optional().default("GET"),
  headers: z.record(z.string(), z.string()).optional().default({}),
  body: z.string().optional(),
  timeout: z.number().optional().default(15_000),
  stripHtml: z.boolean().optional().default(true)
    .describe("Extract plain text from HTML responses. Set to false to keep raw content (e.g. for parsing tables or meta tags). Non-HTML responses are unaffected."),
  isMobile: z.boolean().optional().default(false)
    .describe("Request the mobile version of a page when it may provide more useful content."),
});

export function createWebFetchTool(network: NetworkServiceLike): ToolDefinition {
  return {
    name: "webfetch",
    description: "Fetch URL content via throttled HTTP GET or POST using a browser User-Agent. Set isMobile=true for a mobile page. By default strips HTML tags to return readable text (up to 64KB). Set stripHtml=false to get raw content.",
    source: "builtin",
    inputSchema: WebFetchInputSchema,
    execute: async (args, options) => {
      const parsed = WebFetchInputSchema.safeParse(args);
      if (!parsed.success) {
        return toolResult.failure(parsed.error.message);
      }
      const { timeout, ...request } = parsed.data;
      if (isSearchEngine(parsed.data.url)) {
        return {
          content: "webfetch 不支持搜索引擎。请使用 websearch 工具进行网络搜索。",
          metadata: { ok: true, effect: "none" },
        };
      }
      const result = await network.webFetch(
        { ...request, timeoutMs: timeout },
        { abortSignal: options?.abortSignal, sessionId: options?.sessionId },
      );
      const shouldExtractEvidence = result.ok
        && parsed.data.stripHtml
        && result.contentType?.includes("text/html");
      const evidence = shouldExtractEvidence
        ? extractWebEvidence(result.content, resolveEvidenceQuery(parsed.data.url, options?.evidenceQuery))
        : undefined;
      const output = evidence ? evidence.content : result.content;
      if (!result.ok) return toolResult.failure(result.error ?? "WebFetch failed");
      return output.trim() ? toolResult.evidence(output) : toolResult.none();
    },
    permission: PermissionLevel.READ_ONLY,
  };
}
