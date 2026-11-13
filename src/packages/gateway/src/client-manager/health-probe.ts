/** Health probe with timeout and normalized failure reasons; no logging or restart. */
import type { FetchLike, TimerHandle } from "./runtime";

export type HealthProbeFailureReason = "status" | "timeout" | "network";

export type HealthProbeResult =
  | { healthy: true }
  | { healthy: false; reason: HealthProbeFailureReason; status?: number };

export type HealthProbeOptions = {
  fetch: FetchLike;
  setTimeout: (fn: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
  timeoutMs?: number;
};

export class HealthProbe {
  #fetch: FetchLike;
  #setTimeout: HealthProbeOptions["setTimeout"];
  #clearTimeout: HealthProbeOptions["clearTimeout"];
  #timeoutMs: number;

  constructor(options: HealthProbeOptions) {
    this.#fetch = options.fetch;
    this.#setTimeout = options.setTimeout;
    this.#clearTimeout = options.clearTimeout;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
  }

  async check(url: string, timeoutMs = this.#timeoutMs): Promise<HealthProbeResult> {
    const controller = new AbortController();
    let timer: TimerHandle | undefined;
    const timeout = new Promise<HealthProbeResult>((resolve) => {
      timer = this.#setTimeout(() => {
        controller.abort();
        resolve({ healthy: false, reason: "timeout" });
      }, timeoutMs);
    });

    try {
      return await Promise.race([this.#request(url, controller.signal), timeout]);
    } finally {
      if (timer !== undefined) this.#clearTimeout(timer);
    }
  }

  async #request(url: string, signal: AbortSignal): Promise<HealthProbeResult> {
    try {
      const response = await this.#fetch(url, { signal });
      if (!response.ok) return { healthy: false, reason: "status", status: response.status };
      return { healthy: true };
    } catch {
      return { healthy: false, reason: "network" };
    }
  }
}
