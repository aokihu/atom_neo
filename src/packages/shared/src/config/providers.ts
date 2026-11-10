import { z } from "zod";

export const PROVIDER_TYPES = ["llm", "jev"] as const;
export type ProviderType = typeof PROVIDER_TYPES[number];

export const THINKING_MODES = ["enabled", "disabled", "adaptive"] as const;
export type ThinkingMode = typeof THINKING_MODES[number];

export type ProviderPreset = {
  type?: ProviderType;
  apiKeyEnv: string;
  models: string[];
  baseUrl?: string;
};

export const OPENROUTER_JEV = "openrouter-jev";

/** First-run wizard presets. Keep model lists here; no package should copy them. */
export const PROVIDERS: Record<string, ProviderPreset> = {
  deepseek: {
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  openai: {
    apiKeyEnv: "OPENAI_API_KEY",
    models: ["gpt-4o", "gpt-4o-mini", "o4-mini"],
  },
  custom: {
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
  apiKeyEnv: z.string(),
  models: z.array(z.string()).min(1),
  baseUrl: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  thinking: z.enum(THINKING_MODES).default("disabled"),
  contextLimit: z.number().int().positive().optional(),
});
