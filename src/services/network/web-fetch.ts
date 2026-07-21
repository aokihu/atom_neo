import type { WebFetchRequest, WebFetchResponse } from "@atom-neo/shared";
import type { DomainScheduler } from "./domain-scheduler";

const OUTPUT_LIMIT = 65_536;
const DEFAULT_TIMEOUT_MS = 15_000;
const DESKTOP_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15",
] as const;
const MOBILE_USER_AGENTS = [
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
] as const;

export type FetchTransport = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#x27|#39|nbsp);/g, value =>
      value === "&amp;" ? "&" : value === "&lt;" ? "<" : value === "&gt;" ? ">" :
      value === "&quot;" ? "\"" : value === "&#x27;" || value === "&#39;" ? "'" : " ")
    .replace(/\s+/g, " ")
    .trim();
}

function selectUserAgent(isMobile: boolean, random: () => number): string {
  const pool = isMobile ? MOBILE_USER_AGENTS : DESKTOP_USER_AGENTS;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index];
}

export async function executeWebFetch(params: {
  request: WebFetchRequest;
  signal?: AbortSignal;
  transport: FetchTransport;
  scheduler: DomainScheduler;
  random?: () => number;
}): Promise<WebFetchResponse> {
  const {
    url,
    method = "GET",
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    stripHtml: shouldStrip = true,
    isMobile = false,
  } = params.request;

  let target: URL;
  try {
    target = new URL(url);
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("unsupported protocol");
  } catch {
    return { ok: false, code: "invalid_url", content: "", error: "Invalid HTTP/HTTPS URL" };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (params.signal?.aborted) controller.abort();
  else params.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const scheduled = await params.scheduler.schedule(target, controller.signal);
    if (!scheduled.allowed) {
      const retryAfterMs = scheduled.retryAfterMs ?? 0;
      return {
        ok: false,
        code: "domain_cooldown",
        content: "",
        error: `WEBFETCH_DOMAIN_COOLDOWN [${scheduled.domain}]: retry after ${Math.ceil(retryAfterMs / 1_000)}s`,
        httpStatus: 429,
        rateLimit: {
          domain: scheduled.domain,
          waitedMs: scheduled.waitedMs,
          retryAfterMs,
        },
      };
    }

    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has("user-agent")) {
      requestHeaders.set("user-agent", selectUserAgent(isMobile, params.random ?? Math.random));
    }
    const response = await params.transport(target, {
      method,
      headers: requestHeaders,
      body: method === "POST" ? body : undefined,
      signal: controller.signal,
    });
    const cooldown = response.status === 429
      ? params.scheduler.recordRateLimit(target, response.headers.get("retry-after"))
      : undefined;
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const extracted = shouldStrip && contentType.includes("text/html") ? stripHtml(text) : text;
    const content = extracted.slice(0, OUTPUT_LIMIT) || "(no output)";
    const rateLimit = {
      domain: scheduled.domain,
      waitedMs: scheduled.waitedMs,
      ...(cooldown ? { cooldownMs: cooldown.cooldownMs } : {}),
    };
    const metadata = {
      httpStatus: response.status,
      contentType,
      responseBytes: new TextEncoder().encode(text).byteLength,
      rateLimit,
    };

    return response.ok
      ? { ok: true, code: "success", content, ...metadata }
      : {
          ok: false,
          code: "http_error",
          content,
          error: `HTTP ${response.status} ${response.statusText}`,
          ...metadata,
        };
  } catch (error: any) {
    const aborted = error?.name === "TimeoutError" || error?.name === "AbortError";
    if (aborted) {
      return timedOut
        ? { ok: false, code: "timeout", content: "", error: `Request timed out after ${timeoutMs}ms` }
        : { ok: false, code: "cancelled", content: "", error: "Request cancelled" };
    }
    return {
      ok: false,
      code: "network_error",
      content: "",
      error: `Fetch failed: ${error?.message ?? String(error)}`,
    };
  } finally {
    clearTimeout(timeoutTimer);
    params.signal?.removeEventListener("abort", onAbort);
  }
}
