import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";

const ProviderProfilesSchema = z.object({
  advanced: z.string().default("deepseek/deepseek-v4-flash"),
  balanced: z.string().default("deepseek/deepseek-v4-flash"),
  basic: z.string().default("deepseek/deepseek-v4-flash"),
});

const ProviderDefinitionSchema = z.object({
  apiKeyEnv: z.string(),
  models: z.array(z.string()).min(1),
  baseUrl: z.string().optional(),
  options: z.record(z.unknown()).optional(),
  thinking: z.enum(["enabled", "disabled", "adaptive"]).default("disabled"),
  contextLimit: z.number().int().positive().optional(),
});

const ConfigSchema = z.object({
  version: z.literal(2).default(2),
  theme: z.string().default("dark"),
  providerProfiles: ProviderProfilesSchema.default({
    advanced: "deepseek/deepseek-v4-flash",
    balanced: "deepseek/deepseek-v4-flash",
    basic: "deepseek/deepseek-v4-flash",
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
    theme: z.enum([
      "github-dark", "github-light", "dracula", "nord",
      "tokyo-night", "solarized-dark", "monokai",
    ]).default("github-dark"),
  }).default({ theme: "github-dark" }),
  permission: z.object({
    whitelist: z.array(z.string()).default([]),
  }).default({ whitelist: [] }),
  log: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("debug"),
    ignore: z.array(z.enum(["debug", "info", "warn", "error"])).default([]),
  }).default({ level: "debug", ignore: [] }),
  conversation: z.object({
    maxSteps: z.number().int().min(1).default(20),
    maxChainDepth: z.number().int().min(1).default(5),
  }).default({ maxSteps: 20, maxChainDepth: 5 }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(sandboxPath: string): AppConfig {
  const configPath = `${sandboxPath}/config.json`;
  if (!existsSync(configPath)) {
    const defaults = ConfigSchema.parse({});
    Bun.write(configPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return ConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error(`[config] Invalid config in ${configPath}:`);
      for (const issue of err.issues) {
        const path = issue.path.length ? issue.path.join(".") : "(root)";
        console.error(`  ${path}: ${issue.message}`);
      }
    } else {
      console.error(`[config] Failed to load ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return ConfigSchema.parse({});
  }
}
