export type WebFetchMethod = "GET" | "POST";

export type WebFetchRequest = {
  url: string;
  method?: WebFetchMethod;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  stripHtml?: boolean;
  isMobile?: boolean;
};

export type NetworkRequestOptions = {
  abortSignal?: AbortSignal;
  sessionId?: string;
};

export type WebFetchResultCode =
  | "success"
  | "invalid_url"
  | "domain_cooldown"
  | "http_error"
  | "timeout"
  | "cancelled"
  | "network_error";

export type WebFetchRateLimit = {
  domain: string;
  waitedMs: number;
  retryAfterMs?: number;
  cooldownMs?: number;
};

export type WebFetchResponse = {
  ok: boolean;
  code: WebFetchResultCode;
  content: string;
  error?: string;
  httpStatus?: number;
  contentType?: string;
  responseBytes?: number;
  rateLimit?: WebFetchRateLimit;
};

export interface NetworkServiceLike {
  webFetch(
    request: WebFetchRequest,
    options?: NetworkRequestOptions,
  ): Promise<WebFetchResponse>;
}
