import { z } from "zod";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";

const ProviderProfilesSchema = z.object({
  advanced: z.string().default("deepseek/deepseek-v4-flash"),
  balanced: z.string().default("deepseek/deepseek-v4-flash"),
  basic: z.string().default("deepseek/deepseek-v4-flash"),
  fast: z.string().optional(),
});

const ProviderDefinitionSchema = z.object({
  type: z.enum(["llm", "jev"]).default("llm"),
  apiKeyEnv: z.string(),
  models: z.array(z.string()).min(1),
  baseUrl: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
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
  decisionMode: z.object({
    prediction: z.enum(["legacy", "jev"]).default("legacy"),
    postConversation: z.enum(["legacy", "jev"]).default("legacy"),
  }).default({ prediction: "legacy", postConversation: "legacy" }),
  transport: z.object({
    maxOutputTokens: z.number().int().default(4096),
  }).default({ maxOutputTokens: 4096 }),
  gateway: z.object({
    port: z.number().int().default(3000),
    clients: z.array(z.object({
      id: z.string(),
      platform: z.string(),
      binary: z.string(),
      clientArgs: z.record(z.string(), z.string()).optional(),
      stdio: z.enum(["inherit", "ignore"]).default("inherit"),
    })).default([]),
  }).default({ port: 3000, clients: [] }),
  tui: z.object({
    theme: z.enum([
      "edex", "github-dark", "github-light", "dracula", "nord",
      "tokyo-night", "solarized-dark", "monokai",
    ]).default("edex"),
  }).default({ theme: "edex" }),
  permission: z.object({
    whitelist: z.array(z.string()).default([]),
  }).default({ whitelist: [] }),
  log: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("debug"),
    ignore: z.array(z.enum(["debug", "info", "warn", "error"])).default([]),
  }).default({ level: "debug", ignore: [] }),
  conversation: z.object({
    maxSteps: z.number().int().min(1).default(50),
    maxChainDepth: z.number().int().min(1).default(5),
  }).default({ maxSteps: 50, maxChainDepth: 5 }),
  schedule: z.object({
    persistPath: z.string().default("schedule-tasks.json"),
  }).default({ persistPath: "schedule-tasks.json" }),
  mcpServers: z.array(z.object({
    name: z.string(),
    transport: z.discriminatedUnion("type", [
      z.object({ type: z.literal("http"), url: z.string(), headers: z.record(z.string(), z.string()).optional() }),
      z.object({ type: z.literal("sse"), url: z.string(), headers: z.record(z.string(), z.string()).optional() }),
      z.object({ type: z.literal("stdio"), command: z.string(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(), cwd: z.string().optional() }),
    ]),
  })).default([]),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
export { ConfigSchema };

/** Objects recurse into partials; arrays/records keep full element schemas (wholesale replace). */
function overlaySchema(schema: any): any {
  if (schema instanceof z.ZodDefault) return overlaySchema(schema.removeDefault());
  if (schema instanceof z.ZodOptional) return overlaySchema(schema.unwrap()).optional();
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, any> = {};
    for (const [key, child] of Object.entries(schema.shape)) {
      shape[key] = overlaySchema(child).optional();
    }
    return z.object(shape).strict();
  }
  if (schema instanceof z.ZodRecord) {
    return z.record(schema.keyType, overlaySchema(schema.valueType));
  }
  return schema;
}

type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type RuntimeConfig = DeepPartial<Omit<AppConfig, "gateway">>;

export const RuntimeConfigSchema: z.ZodType<RuntimeConfig> = overlaySchema(
  ConfigSchema.omit({ gateway: true }),
) as z.ZodType<RuntimeConfig>;

export type LoadedConfig = {
  userConfig: AppConfig;
  runtimeConfig: RuntimeConfig;
  effective: AppConfig;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep merge: objects recurse, arrays/records/primitives replace wholesale. */
export function mergeConfig(base: object, overlay: object): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const prev = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(value) && isPlainObject(prev) ? mergeConfig(prev, value) : value;
  }
  return out;
}

export function runtimeConfigPath(sandboxPath: string): string {
  return `${sandboxPath}/.atom/runtime-config.json`;
}

/** Drop provider entries that fail their schema so one broken provider cannot nuke the whole config. */
function sanitizeProviders(raw: unknown): Record<string, unknown> {
  const config = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const providers = config.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return config;
  const cleaned: Record<string, unknown> = {};
  for (const [id, def] of Object.entries(providers as Record<string, unknown>)) {
    const result = ProviderDefinitionSchema.safeParse(def);
    if (result.success) cleaned[id] = result.data;
    else console.error(`[config] Dropping invalid provider "${id}"`);
  }
  return { ...config, providers: cleaned };
}

function loadUserConfig(sandboxPath: string): AppConfig {
  const configPath = `${sandboxPath}/config.json`;
  if (!existsSync(configPath)) {
    const defaults = ConfigSchema.parse({});
    Bun.write(configPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error(`[config] Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
    return ConfigSchema.parse({});
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  console.error(`[config] Invalid config in ${configPath}:`);
  for (const issue of parsed.error.issues) {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    console.error(`  ${path}: ${issue.message}`);
  }
  const sanitized = sanitizeProviders(raw);
  const recovered = ConfigSchema.safeParse(sanitized);
  if (recovered.success) {
    console.error(`[config] Recovered ${configPath} by dropping invalid provider entries`);
    return recovered.data;
  }
  return ConfigSchema.parse({});
}

export function loadRuntimeConfig(sandboxPath: string): RuntimeConfig {
  const path = runtimeConfigPath(sandboxPath);
  if (!existsSync(path)) return {};
  try {
    return RuntimeConfigSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error(`[config] Invalid runtime config in ${path}, ignoring overlay:`);
      for (const issue of err.issues) {
        const path = issue.path.length ? issue.path.join(".") : "(root)";
        console.error(`  ${path}: ${issue.message}`);
      }
    } else {
      console.error(`[config] Failed to load ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return {};
  }
}

export function saveRuntimeConfig(sandboxPath: string, overlay: RuntimeConfig): void {
  const atomDir = `${sandboxPath}/.atom`;
  if (!existsSync(atomDir)) mkdirSync(atomDir, { recursive: true });
  Bun.write(runtimeConfigPath(sandboxPath), JSON.stringify(overlay, null, 2));
}

export function deleteRuntimeConfig(sandboxPath: string): void {
  const path = runtimeConfigPath(sandboxPath);
  if (existsSync(path)) rmSync(path);
}

export function loadConfig(sandboxPath: string): LoadedConfig {
  const userConfig = loadUserConfig(sandboxPath);
  const runtimeConfig = loadRuntimeConfig(sandboxPath);
  const effective = ConfigSchema.parse(mergeConfig(userConfig, runtimeConfig));
  return { userConfig, runtimeConfig, effective };
}
