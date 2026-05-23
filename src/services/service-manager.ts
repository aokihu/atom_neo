import type { BaseService } from "./base-service";

export class ServiceManager {
  #services = new Map<string, BaseService>();

  register(name: string, service: BaseService): void {
    if (this.#services.has(name)) throw new Error(`Service "${name}" already registered`);
    this.#services.set(name, service);
  }

  get<T extends BaseService>(name: string): T | undefined {
    return this.#services.get(name) as T | undefined;
  }

  async startAll(): Promise<void> {
    for (const [name, svc] of this.#services) {
      try { await svc.start(); } catch (err) { console.error(`Service "${name}" failed:`, err); }
    }
  }

  async stopAll(): Promise<void> {
    for (const [name, svc] of this.#services) {
      try { await svc.stop(); } catch (err) { console.error(`Service "${name}" failed:`, err); }
    }
  }
}
