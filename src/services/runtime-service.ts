import { BaseService } from "./base-service";
import type { Mode } from "./types";

export type RuntimeParams = {
  mode: Mode;
  port: number;
  host: string;
  sandbox: string;
  apiKey: string;
  appConfig?: Record<string, any>;
};

export class RuntimeService extends BaseService {
  readonly name = "runtime";

  readonly mode: Mode;
  readonly port: number;
  readonly host: string;
  #sandbox: string;
  #apiKey: string;
  #appConfig: Record<string, any> = {};

  constructor(params: RuntimeParams) {
    super();
    this.mode = params.mode;
    this.port = params.port;
    this.host = params.host;
    this.#sandbox = params.sandbox;
    this.#apiKey = params.apiKey;
    this.#appConfig = params.appConfig ?? {};
  }

  get sandbox(): string              { return this.#sandbox; }
  get sandboxDir(): string           { return this.#sandbox; }
  get atomDir(): string              { return `${this.#sandbox}/.atom`; }
  get configPath(): string           { return `${this.#sandbox}/config.json`; }
  get envPath(): string              { return `${this.#sandbox}/.env`; }
  get agentsPath(): string           { return `${this.#sandbox}/AGENTS.md`; }
  get compiledPromptsDir(): string   { return `${this.atomDir}/compiled_prompts`; }
  get logsDir(): string              { return `${this.#sandbox}/logs`; }
  get metaPath(): string             { return `${this.atomDir}/agents_meta.json`; }
  get apiKey(): string               { return this.#apiKey; }

  get appConfig(): Record<string, any> { return this.#appConfig; }
  get maxTokens(): number {
    return this.#appConfig?.transport?.maxOutputTokens ?? 4096;
  }
}
