const DEFAULT_MIN_INTERVAL_MS = 1_000;
const SEARCH_MIN_INTERVAL_MS = 5_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const SEARCH_DOMAIN_SUFFIXES = [
  "google.com", "bing.com", "baidu.com", "duckduckgo.com",
  "sogou.com", "so.com", "search.yahoo.com", "so.html5.qq.com",
];

type DomainState = { nextAllowedAt: number; cooldownUntil: number };

export type DomainSchedulerOptions = {
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  defaultMinIntervalMs?: number;
  searchMinIntervalMs?: number;
  defaultRateLimitCooldownMs?: number;
};

export type DomainScheduleDecision = {
  allowed: boolean;
  domain: string;
  waitedMs: number;
  retryAfterMs?: number;
};

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function parseRetryAfter(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

export class DomainScheduler {
  readonly #states = new Map<string, DomainState>();
  readonly #now: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #defaultMinIntervalMs: number;
  readonly #searchMinIntervalMs: number;
  readonly #defaultRateLimitCooldownMs: number;

  constructor(options: DomainSchedulerOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? abortableSleep;
    this.#defaultMinIntervalMs = options.defaultMinIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.#searchMinIntervalMs = options.searchMinIntervalMs ?? SEARCH_MIN_INTERVAL_MS;
    this.#defaultRateLimitCooldownMs = options.defaultRateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  }

  async schedule(url: URL, signal?: AbortSignal): Promise<DomainScheduleDecision> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const { domain, intervalMs } = this.#policy(url.hostname);
    const state = this.#state(domain);
    const now = this.#now();
    if (state.cooldownUntil > now) {
      return { allowed: false, domain, waitedMs: 0, retryAfterMs: state.cooldownUntil - now };
    }

    const scheduledAt = Math.max(now, state.nextAllowedAt);
    state.nextAllowedAt = scheduledAt + intervalMs;
    const waitedMs = scheduledAt - now;
    await this.#sleep(waitedMs, signal);

    const afterWait = this.#now();
    return state.cooldownUntil > afterWait
      ? { allowed: false, domain, waitedMs, retryAfterMs: state.cooldownUntil - afterWait }
      : { allowed: true, domain, waitedMs };
  }

  recordRateLimit(url: URL, retryAfter: string | null): { domain: string; cooldownMs: number } {
    const { domain } = this.#policy(url.hostname);
    const state = this.#state(domain);
    const now = this.#now();
    const cooldownMs = Math.max(
      this.#defaultRateLimitCooldownMs,
      parseRetryAfter(retryAfter, now),
    );
    state.cooldownUntil = Math.max(state.cooldownUntil, now + cooldownMs);
    state.nextAllowedAt = Math.max(state.nextAllowedAt, state.cooldownUntil);
    return { domain, cooldownMs: state.cooldownUntil - now };
  }

  clear(): void {
    this.#states.clear();
  }

  #policy(hostname: string): { domain: string; intervalMs: number } {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    const searchDomain = SEARCH_DOMAIN_SUFFIXES.find(
      suffix => host === suffix || host.endsWith(`.${suffix}`),
    );
    return searchDomain
      ? { domain: searchDomain, intervalMs: this.#searchMinIntervalMs }
      : { domain: host, intervalMs: this.#defaultMinIntervalMs };
  }

  #state(domain: string): DomainState {
    let state = this.#states.get(domain);
    if (!state) {
      state = { nextAllowedAt: 0, cooldownUntil: 0 };
      this.#states.set(domain, state);
    }
    return state;
  }
}
