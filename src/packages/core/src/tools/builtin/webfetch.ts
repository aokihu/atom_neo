import { z } from "zod";
import type { NetworkServiceLike, ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";

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
      if (!parsed.success) return { ok: false, output: "", error: parsed.error.message };
      const { timeout, ...request } = parsed.data;
      const result = await network.webFetch(
        { ...request, timeoutMs: timeout },
        { abortSignal: options?.abortSignal, sessionId: options?.sessionId },
      );
      const data = result.httpStatus !== undefined || result.contentType !== undefined || result.rateLimit
        ? {
            ...(result.httpStatus !== undefined ? { status: result.httpStatus } : {}),
            ...(result.contentType !== undefined ? { contentType: result.contentType } : {}),
            ...(result.rateLimit ? { rateLimit: result.rateLimit } : {}),
          }
        : undefined;
      return {
        ok: result.ok,
        output: result.content,
        ...(result.error ? { error: result.error } : {}),
        ...(data ? { data } : {}),
      };
    },
    permission: PermissionLevel.READ_ONLY,
  };
}
