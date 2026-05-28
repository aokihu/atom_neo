import type { Mode } from "./types";
import type { AppConfig } from "../bootstrap/config";

export type ProfileLevel = "advanced" | "balanced" | "basic";

export type ResolvedModel = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  thinking?: "enabled" | "disabled" | "adaptive";
};

export type RuntimeParams = {
  mode: Mode;
  port: number;
  host: string;
  sandbox: string;
  apiKey: string;
  appConfig?: AppConfig;
};

export class RuntimeService {
  readonly mode: Mode;
  readonly port: number;
  readonly host: string;
  #sandbox: string;
  #apiKey: string;
  #appConfig: AppConfig | null = null;

  constructor(params: RuntimeParams) {
    this.mode = params.mode;
    this.port = params.port;
    this.host = params.host;
    this.#sandbox = params.sandbox;
    this.#apiKey = params.apiKey;
    this.#appConfig = params.appConfig ?? null;
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

  get appConfig(): AppConfig | null { return this.#appConfig; }
  get maxTokens(): number {
    return this.#appConfig?.transport?.maxOutputTokens ?? 4096;
  }

  getResolvedModel(level: ProfileLevel = "balanced"): ResolvedModel {
    const profiles = this.#appConfig?.providerProfiles ?? {};
    const profileId: string = profiles[level] ?? "deepseek/deepseek-chat";

    const sepIndex = profileId.indexOf("/");
    const provider = sepIndex >= 0 ? profileId.slice(0, sepIndex) : "deepseek";
    const model = sepIndex >= 0 ? profileId.slice(sepIndex + 1) : profileId;

    const providerConfig = this.#appConfig?.providers?.[provider];
    const apiKeyEnv = providerConfig?.apiKeyEnv;
    const apiKey = (apiKeyEnv ? process.env[apiKeyEnv] : undefined) ?? this.#apiKey;

    return { provider, model, apiKey, baseUrl: providerConfig?.baseUrl, thinking: providerConfig?.thinking };
  }
}
