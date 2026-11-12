import type { Logger } from "@atom-neo/shared";

export abstract class BaseService {
  abstract readonly name: string;

  #running = false;
  #logger: Logger | null = null;

  get logger(): Logger | null { return this.#logger; }

  setLogger(logger: Logger): void { this.#logger = logger; }

  get isRunning(): boolean { return this.#running; }

  async start(): Promise<void> {
    if (this.#running) return;
    try {
      await this.onStart();
      this.#running = true;
    } catch (error) {
      // onStart may have acquired resources before failing; onStop must be idempotent.
      try { await this.onStop(); } catch {}
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.#running) return;
    try {
      await this.onStop();
    } finally {
      this.#running = false;
    }
  }

  /** Subclass initialization; runs before the service is marked running. */
  protected async onStart(): Promise<void> {}

  /** Subclass teardown; runs before the service is marked stopped. */
  protected async onStop(): Promise<void> {}

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}
