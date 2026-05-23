export abstract class BaseService {
  abstract readonly name: string;

  #running = false;

  get isRunning(): boolean {
    return this.#running;
  }

  async start(): Promise<void> {
    this.#running = true;
  }

  async stop(): Promise<void> {
    this.#running = false;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}
