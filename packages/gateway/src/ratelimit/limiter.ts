export class RateLimiter {
  #window: Map<string, { count: number; resetAt: number }> = new Map();
  #maxRequests: number;
  #burst: number;

  constructor(params: { maxRequests: number; burst: number }) {
    this.#maxRequests = params.maxRequests;
    this.#burst = params.burst;
  }

  allow(key: string): boolean {
    const now = Date.now();
    const entry = this.#window.get(key);

    if (!entry || now > entry.resetAt) {
      this.#window.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    if (entry.count >= this.#maxRequests + this.#burst) return false;
    entry.count++;
    return true;
  }

  reset(key: string): void {
    this.#window.delete(key);
  }
}
