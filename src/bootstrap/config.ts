import { z } from "zod";
import { readFileSync } from "node:fs";

const ProviderProfilesSchema = z.object({
  advanced: z.string().default("deepseek/deepseek-chat"),
  balanced: z.string().default("deepseek/deepseek-chat"),
  basic: z.string().default("deepseek/deepseek-chat"),
});

const ProviderDefinitionSchema = z.object({
  apiKeyEnv: z.string(),
  models: z.array(z.string()).min(1),
  baseUrl: z.string().optional(),
  options: z.record(z.unknown()).optional(),
});

const ConfigSchema = z.object({
  version: z.literal(2).default(2),
  theme: z.string().default("dark"),
  providerProfiles: ProviderProfilesSchema.default({
    advanced: "deepseek/deepseek-chat",
    balanced: "deepseek/deepseek-chat",
    basic: "deepseek/deepseek-chat",
  }),
  providers: z.record(z.string(), ProviderDefinitionSchema).default({}),
  transport: z.object({
    maxOutputTokens: z.number().int().default(4096),
  }).default({ maxOutputTokens: 4096 }),
  gateway: z.object({
    jwtSecret: z.string().default("change-me-minimum-16-chars"),
    port: z.number().int().default(3000),
  }).default({ jwtSecret: "change-me-minimum-16-chars", port: 3000 }),
  tui: z.object({
    theme: z.enum(["dark", "light"]).default("dark"),
  }).default({ theme: "dark" }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(sandboxPath: string): AppConfig {
  const configPath = `${sandboxPath}/config.json`;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return ConfigSchema.parse(raw);
  } catch {
    return ConfigSchema.parse({});
  }
}
