import { z } from "zod";

export const PROVIDER_TYPES = ["llm", "jev"] as const;
export type ProviderType = typeof PROVIDER_TYPES[number];

export const PROVIDER_PROTOCOLS = ["deepseek", "openai", "anthropic", "openai-compatible"] as const;
export type ProviderProtocol = typeof PROVIDER_PROTOCOLS[number];

export const THINKING_MODES = ["enabled", "disabled", "adaptive"] as const;
export type ThinkingMode = typeof THINKING_MODES[number];

export type ProfileLevel = "advanced" | "balanced" | "basic" | "fast";

export type ResolvedModel = {
  provider: string;
  protocol: ProviderProtocol;
  model: string;
  type: "llm" | "jev";
  apiKey: string;
  baseUrl?: string;
  thinking?: ThinkingMode;
  options?: Record<string, unknown>;
};

export type ProviderPreset = {
  type?: ProviderType;
  protocol?: ProviderProtocol;
  apiKeyEnv: string;
  models: string[];
  baseUrl?: string;
};

export const OPENROUTER_JEV = "openrouter-jev";

/** First-run wizard presets. Keep model lists here; no package should copy them. */
export const PROVIDERS: Record<string, ProviderPreset> = {
  deepseek: {
    protocol: "deepseek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  openai: {
    protocol: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
    models: ["gpt-4o", "gpt-4o-mini", "o4-mini"],
  },
  custom: {
    protocol: "openai-compatible",
    apiKeyEnv: "",
    models: [],
  },
  [OPENROUTER_JEV]: {
    type: "jev",
    apiKeyEnv: "OPENROUTER_API_KEY",
    models: ["typesafe/jev-1.13"],
    baseUrl: "https://openrouter.ai/api/alpha/decisions",
  },
};

/**
 * Resolve the wire protocol for a provider. Explicit config wins, then known
 * vendor ids; anything else is treated as an OpenAI-compatible endpoint.
 */
export function inferProviderProtocol(
  providerId: string,
  providerConfig?: { protocol?: string } | null,
): ProviderProtocol {
  const explicit = providerConfig?.protocol;
  if (PROVIDER_PROTOCOLS.includes(explicit as ProviderProtocol)) return explicit as ProviderProtocol;
  if (providerId === "deepseek" || providerId === "openai" || providerId === "anthropic") return providerId;
  return "openai-compatible";
}

export const DEFAULT_PROFILES = {
  advanced: "deepseek/deepseek-v4-flash",
  balanced: "deepseek/deepseek-v4-flash",
  basic: "deepseek/deepseek-v4-flash",
} as const;

export type DecisionModes = {
  prediction: "legacy" | "jev";
  postConversation: "legacy" | "jev";
  continuation: "rules" | "jev";
};

export const DEFAULT_DECISION_MODES: DecisionModes = {
  prediction: "legacy",
  postConversation: "legacy",
  continuation: "jev",
};

export const ProviderProfilesSchema = z.object({
  advanced: z.string().default(DEFAULT_PROFILES.advanced),
  balanced: z.string().default(DEFAULT_PROFILES.balanced),
  basic: z.string().default(DEFAULT_PROFILES.basic),
  fast: z.string().optional(),
});

export const ProviderDefinitionSchema = z.object({
  type: z.enum(PROVIDER_TYPES).default("llm"),
  protocol: z.enum(PROVIDER_PROTOCOLS).optional(),
  apiKeyEnv: z.string(),
  models: z.array(z.string()).min(1),
  baseUrl: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  thinking: z.enum(THINKING_MODES).default("disabled"),
  contextLimit: z.number().int().positive().optional(),
});
