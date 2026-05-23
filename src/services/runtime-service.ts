import { BaseService } from "./base-service";
import type { Mode } from "./types";

export type RuntimeParams = {
  mode: Mode;
  port: number;
  host: string;
  sandbox: string;
  apiKey: string;
};

export class RuntimeService extends BaseService {
  readonly name = "runtime";

  readonly mode: Mode;
  readonly port: number;
  readonly host: string;
  #sandbox: string;
  #apiKey: string;

  constructor(params: RuntimeParams) {
    super();
    this.mode = params.mode;
    this.port = params.port;
    this.host = params.host;
    this.#sandbox = params.sandbox;
    this.#apiKey = params.apiKey;
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
}
