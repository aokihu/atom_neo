import type { BaseService } from "./base-service";
import type { Logger } from "@atom-neo/shared";

export class ServiceManager {
  #services = new Map<string, BaseService>();
  #logger: Logger | null = null;

  constructor(params?: { logger?: Logger }) {
    this.#logger = params?.logger ?? null;
  }

  register(name: string, service: BaseService): void {
    if (this.#services.has(name)) throw new Error(`Service "${name}" already registered`);
    if (this.#logger) service.setLogger(this.#logger);
    this.#services.set(name, service);
  }

  get<T>(name: string): T | undefined {
    return this.#services.get(name) as unknown as T | undefined;
  }

  async startAll(): Promise<void> {
    const started: BaseService[] = [];
    try {
      for (const [name, svc] of this.#services) {
        try {
          await svc.start();
        } catch (error) {
          this.#logger?.error(`Service "${name}" start failed`, { error: String(error) });
          throw error;
        }
        started.push(svc);
      }
    } catch (error) {
      for (const svc of started.reverse()) {
        try { await svc.stop(); } catch (stopError) { this.#logger?.error(`Service "${svc.name}" rollback stop failed`, { error: String(stopError) }); }
      }
      throw error;
    }
  }

  async stopAll(): Promise<void> {
    for (const [name, svc] of this.#services) {
      try { await svc.stop(); } catch (err) { this.#logger?.error(`Service "${name}" stop failed`, { error: String(err) }); }
    }
  }
}
