import { randomUUID } from "node:crypto";
import type {
  NetworkRequestOptions,
  NetworkServiceLike,
  WebFetchRequest,
  WebFetchResponse,
} from "@atom-neo/shared";
import { BaseService } from "../base-service";
import { DomainScheduler } from "./domain-scheduler";
import type { DomainSchedulerOptions } from "./domain-scheduler";
import { executeWebFetch } from "./web-fetch";
import type { FetchTransport } from "./web-fetch";

export type NetworkServiceOptions = DomainSchedulerOptions & {
  fetch?: FetchTransport;
  random?: () => number;
};

export class NetworkService extends BaseService implements NetworkServiceLike {
  readonly name = "network";

  readonly #transport: FetchTransport;
  readonly #scheduler: DomainScheduler;
  readonly #random: () => number;
  #stopController = new AbortController();

  constructor(options: NetworkServiceOptions = {}) {
    super();
    this.#transport = options.fetch ?? fetch;
    this.#scheduler = new DomainScheduler(options);
    this.#random = options.random ?? Math.random;
  }

  async start(): Promise<void> {
    this.#scheduler.clear();
    this.#stopController = new AbortController();
    await super.start();
  }

  async stop(): Promise<void> {
    this.#stopController.abort();
    this.#scheduler.clear();
    await super.stop();
  }

  async webFetch(
    request: WebFetchRequest,
    options?: NetworkRequestOptions,
  ): Promise<WebFetchResponse> {
    if (!this.isRunning) {
      return {
        ok: false,
        code: "network_error",
        content: "",
        error: "Network service is not running",
      };
    }

    const requestId = randomUUID();
    const startedAt = performance.now();
    const domain = this.#domain(request.url);
    this.logger?.debug("network request started", {
      requestId,
      feature: "webfetch",
      domain,
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
    });

    const signal = options?.abortSignal
      ? AbortSignal.any([options.abortSignal, this.#stopController.signal])
      : this.#stopController.signal;
    const result = await executeWebFetch({
      request,
      signal,
      transport: this.#transport,
      scheduler: this.#scheduler,
      random: this.#random,
    });
    const durationMs = performance.now() - startedAt;
    const context = {
      requestId,
      feature: "webfetch",
      domain: result.rateLimit?.domain ?? domain,
      code: result.code,
      ok: result.ok,
      durationMs,
      queueWaitMs: result.rateLimit?.waitedMs ?? 0,
      networkMs: Math.max(0, durationMs - (result.rateLimit?.waitedMs ?? 0)),
      ...(result.httpStatus !== undefined ? { status: result.httpStatus } : {}),
      ...(result.responseBytes !== undefined ? { responseBytes: result.responseBytes } : {}),
      ...(result.rateLimit?.cooldownMs !== undefined ? { cooldownMs: result.rateLimit.cooldownMs } : {}),
      ...(result.rateLimit?.retryAfterMs !== undefined ? { retryAfterMs: result.rateLimit.retryAfterMs } : {}),
    };
    if (result.ok) this.logger?.debug("network request completed", context);
    else if (result.code === "domain_cooldown" || result.code === "http_error") {
      this.logger?.warn("network request rejected", context);
    } else {
      this.logger?.debug("network request failed", context);
    }
    return result;
  }

  #domain(value: string): string {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return "invalid";
    }
  }
}
