/**
 * One-shot wakeup primitive for the TaskEngine run loop.
 * A notify that arrives before wait() is retained until the next wait; repeated
 * notifies are idempotent. No timers or polling.
 */
export class Wakeup {
  #pending = false;
  #resolve?: () => void;

  notify(): void {
    if (this.#resolve) {
      const resolve = this.#resolve;
      this.#resolve = undefined;
      resolve();
    } else {
      this.#pending = true;
    }
  }

  async wait(): Promise<void> {
    if (this.#pending) {
      this.#pending = false;
      return;
    }
    await new Promise<void>((resolve) => { this.#resolve = resolve; });
  }
}
