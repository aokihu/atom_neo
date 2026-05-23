import type { BaseService } from "./base-service";

export interface CompilerAccess {
  getCompiledAgentsPrompt(): string;
}

export class ServiceManager {
  #services = new Map<string, BaseService>();

  register(name: string, service: BaseService): void {
    if (this.#services.has(name)) {
      throw new Error(`Service "${name}" already registered`);
    }
    this.#services.set(name, service);
  }

  get<T extends BaseService>(name: string): T | undefined {
    return this.#services.get(name) as T | undefined;
  }

  async startAll(): Promise<void> {
    for (const [name, svc] of this.#services) {
      try {
        await svc.start();
      } catch (err) {
        console.error(`Service "${name}" failed to start:`, err);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [name, svc] of this.#services) {
      try {
        await svc.stop();
      } catch (err) {
        console.error(`Service "${name}" failed to stop:`, err);
      }
    }
  }

  getCompiledAgentsPrompt(): string {
    const compiler = this.#services.get("agents-compiler");
    if (compiler && "getCompiledPrompt" in compiler) {
      return (compiler as any).getCompiledPrompt();
    }
    return "";
  }
}
