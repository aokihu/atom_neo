import type { Logger } from "@atom-neo/shared";

export abstract class BaseService {
  abstract readonly name: string;

  #running = false;
  #logger: Logger | null = null;

  get logger(): Logger | null { return this.#logger; }

  setLogger(logger: Logger): void { this.#logger = logger; }

  get isRunning(): boolean { return this.#running; }

  async start(): Promise<void> { this.#running = true; }
  async stop(): Promise<void> { this.#running = false; }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}
