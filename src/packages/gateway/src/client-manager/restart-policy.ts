/** Restart limits and exponential backoff for one client process. */
export const DEFAULT_MAX_RESTART_ATTEMPTS = 5;
export const DEFAULT_RESTART_BASE_DELAY_MS = 1_000;
export const DEFAULT_RESTART_MAX_DELAY_MS = 30_000;

export type RestartDecision =
  | { action: "restart"; attempt: number; delayMs: number }
  | { action: "give_up"; attempts: number };

export type RestartPolicyOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export class RestartPolicy {
  #maxAttempts: number;
  #baseDelayMs: number;
  #maxDelayMs: number;
  #attempts = 0;

  constructor(options: RestartPolicyOptions = {}) {
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS;
    this.#baseDelayMs = options.baseDelayMs ?? DEFAULT_RESTART_BASE_DELAY_MS;
    this.#maxDelayMs = options.maxDelayMs ?? DEFAULT_RESTART_MAX_DELAY_MS;
  }

  get attempts(): number {
    return this.#attempts;
  }

  next(): RestartDecision {
    if (this.#attempts >= this.#maxAttempts) {
      return { action: "give_up", attempts: this.#attempts };
    }
    const attempt = this.#attempts + 1;
    this.#attempts = attempt;
    return {
      action: "restart",
      attempt,
      delayMs: Math.min(this.#baseDelayMs * 2 ** (attempt - 1), this.#maxDelayMs),
    };
  }

  reset(): void {
    this.#attempts = 0;
  }
}
