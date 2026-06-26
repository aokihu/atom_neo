import { z } from "zod";
import type { ToolDefinition, ToolExecuteOptions } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";

const OUTPUT_LIMIT = 65536;

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#x27|#39|nbsp);/g, m =>
      m === '&amp;' ? '&' : m === '&lt;' ? '<' : m === '&gt;' ? '>' :
      m === '&quot;' ? '"' : m === '&#x27;' || m === '&#39;' ? "'" : ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createWebFetchTool(): ToolDefinition {
  const schema = z.object({
    url: z.string().describe("HTTP/HTTPS URL to fetch"),
    method: z.enum(["GET", "POST"]).optional().default("GET"),
    headers: z.record(z.string(), z.string()).optional().default({}),
    body: z.string().optional(),
    timeout: z.number().optional().default(15_000),
    stripHtml: z.boolean().optional().default(true)
      .describe("Extract plain text from HTML responses. Set to false to keep raw content (e.g. for parsing tables or meta tags). Non-HTML responses are unaffected."),
  });

  return {
    name: "webfetch",
    description: "Fetch URL content via HTTP GET or POST. By default strips HTML tags to return readable text (up to 64KB). Set stripHtml=false to get raw content.",
    source: "builtin",
    inputSchema: schema,
    execute: async (args, opts?: ToolExecuteOptions) => {
      const r = schema.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      const { url, method, headers, body, timeout, stripHtml: shouldStrip } = r.data;

      const controller = new AbortController();
      const timeoutTimer = setTimeout(() => controller.abort(), timeout);
      const mergedSignal = opts?.abortSignal
        ? (opts.abortSignal.addEventListener("abort", () => controller.abort()), controller.signal)
        : controller.signal;

      try {
        const response = await fetch(url, {
          method,
          headers: { "User-Agent": "AtomNeo/1.0", ...headers },
          body: method === "POST" ? body : undefined,
          signal: mergedSignal,
        });

        const text = await response.text();
        const contentType = response.headers.get("content-type") ?? "";
        const extractText = shouldStrip && contentType.includes("text/html") ? stripHtml(text) : text;
        const output = extractText.slice(0, OUTPUT_LIMIT) || "(no output)";

        if (response.ok) {
          return { ok: true, output, data: { status: response.status, contentType: response.headers.get("content-type") } };
        }
        return { ok: false, output, error: `HTTP ${response.status} ${response.statusText}` };
      } catch (err: any) {
        return { ok: false, output: "", error: err?.name === "TimeoutError" || err?.name === "AbortError"
          ? `Request timed out after ${timeout}ms`
          : `Fetch failed: ${err?.message ?? String(err)}` };
      } finally {
        clearTimeout(timeoutTimer);
      }
    },
    permission: PermissionLevel.READ_ONLY,
  };
}
