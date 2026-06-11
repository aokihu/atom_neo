import { z } from "zod";
import type { ToolDefinition, ToolExecuteOptions } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";

const OUTPUT_LIMIT = 65536;

export function createWebFetchTool(): ToolDefinition {
  const schema = z.object({
    url: z.string().describe("HTTP/HTTPS URL to fetch"),
    method: z.enum(["GET", "POST"]).optional().default("GET"),
    headers: z.record(z.string(), z.string()).optional().default({}),
    body: z.string().optional(),
    timeout: z.number().optional().default(15_000),
  });

  return {
    name: "webfetch",
    description: "Fetch URL content via HTTP GET or POST. Returns response body (up to 64KB).",
    source: "builtin",
    inputSchema: schema,
    execute: async (args, opts?: ToolExecuteOptions) => {
      const r = schema.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      const { url, method, headers, body, timeout } = r.data;

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
        const output = text.slice(0, OUTPUT_LIMIT) || "(no output)";

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
