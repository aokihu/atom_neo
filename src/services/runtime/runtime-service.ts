import { inferProviderProtocol } from "@atom-neo/shared";
import type { ProfileLevel, ResolvedModel } from "@atom-neo/shared";
import type { Mode } from "../base/types";
import {
  ConfigSchema, RuntimeConfigSchema, mergeConfig, saveRuntimeConfig, deleteRuntimeConfig,
} from "../../bootstrap/config";
import type { AppConfig, LoadedConfig, RuntimeConfig } from "../../bootstrap/config";

export type { ProfileLevel, ResolvedModel } from "@atom-neo/shared";

export type RuntimeParams = {
  mode: Mode;
  port: number;
  host: string;
  sandbox: string;
  config?: LoadedConfig;
};

export class RuntimeService {
  readonly mode: Mode;
  readonly port: number;
  readonly host: string;
  #sandbox: string;
  #userConfig: AppConfig;
  #runtimeConfig: RuntimeConfig;
  #effective: AppConfig;

  constructor(params: RuntimeParams) {
    this.mode = params.mode;
    this.port = params.port;
    this.host = params.host;
    this.#sandbox = params.sandbox;
    this.#userConfig = params.config?.userConfig ?? ConfigSchema.parse({});
    this.#runtimeConfig = params.config?.runtimeConfig ?? {};
    this.#effective = params.config?.effective ?? this.#userConfig;
  }

  get sandbox(): string              { return this.#sandbox; }
  get sandboxDir(): string           { return this.#sandbox; }
  get atomDir(): string              { return `${this.#sandbox}/.atom`; }
  get configPath(): string           { return `${this.#sandbox}/config.json`; }
  get runtimeConfigPath(): string    { return `${this.atomDir}/runtime-config.json`; }
  get envPath(): string              { return `${this.#sandbox}/.env`; }
  get agentsPath(): string           { return `${this.#sandbox}/AGENTS.md`; }
  get compiledPromptsDir(): string   { return `${this.atomDir}/compiled_prompts`; }
  get logsDir(): string              { return `${this.#sandbox}/logs`; }
  get metaPath(): string             { return `${this.atomDir}/agents_meta.json`; }

  get appConfig(): AppConfig { return this.#effective; }
  get userConfig(): AppConfig { return this.#userConfig; }
  get runtimeConfig(): RuntimeConfig { return this.#runtimeConfig; }
  get maxTokens(): number {
    return this.#effective.transport?.maxOutputTokens ?? 4096;
  }

  /** Merge a validated patch into the runtime overlay, persist it, and return the new effective config. */
  updateRuntimeConfig(patch: unknown): AppConfig {
    const parsed = RuntimeConfigSchema.parse(patch);
    this.#runtimeConfig = mergeConfig(this.#runtimeConfig, parsed) as RuntimeConfig;
    saveRuntimeConfig(this.#sandbox, this.#runtimeConfig);
    this.#effective = ConfigSchema.parse(mergeConfig(this.#userConfig, this.#runtimeConfig));
    return this.#effective;
  }

  /** Drop the runtime overlay and fall back to the pure user config. */
  resetRuntimeConfig(): AppConfig {
    this.#runtimeConfig = {};
    deleteRuntimeConfig(this.#sandbox);
    this.#effective = this.#userConfig;
    return this.#effective;
  }

  getResolvedModel(level: ProfileLevel = "balanced"): ResolvedModel {
    const profiles = this.#effective.providerProfiles ?? {};
    const profileId: string = profiles[level] ?? profiles.basic ?? "deepseek/deepseek-v4-flash";

    const sepIndex = profileId.indexOf("/");
    const provider = sepIndex >= 0 ? profileId.slice(0, sepIndex) : "deepseek";
    const model = sepIndex >= 0 ? profileId.slice(sepIndex + 1) : profileId;

    const providerConfig = this.#effective.providers?.[provider];
    const apiKeyEnv = providerConfig?.apiKeyEnv;
    const type = providerConfig?.type ?? "llm";
    // Only the configured provider's env var is used. Never fall back to
    // another provider's key (see CR-PRO-06).
    const apiKey = apiKeyEnv ? process.env[apiKeyEnv] ?? "" : "";

    return {
      provider,
      protocol: inferProviderProtocol(provider, providerConfig),
      model,
      type,
      apiKey,
      baseUrl: providerConfig?.baseUrl,
      thinking: providerConfig?.thinking,
      options: providerConfig?.options,
    };
  }
}
