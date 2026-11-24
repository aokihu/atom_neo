import { existsSync, readFileSync, rmSync } from "node:fs";
import { z } from "zod";
import {
  ClientConfigSchema,
  ConfigSchema,
  ProviderDefinitionSchema,
  ProviderProfilesSchema,
  RuntimeConfigSchema,
  clientConfigMigrationHint,
  mergeConfig,
  overlaySchema,
  runtimeConfigPath,
  writeFileAtomic,
} from "@atom-neo/shared";
import type { AppConfig, DeepPartial, RuntimeConfig } from "@atom-neo/shared";

export {
  ConfigSchema,
  ProviderDefinitionSchema,
  ProviderProfilesSchema,
  RuntimeConfigSchema,
  mergeConfig,
  overlaySchema,
  runtimeConfigPath,
};
export type { AppConfig, DeepPartial, RuntimeConfig };

export type LoadedConfig = {
  userConfig: AppConfig;
  runtimeConfig: RuntimeConfig;
  effective: AppConfig;
};

/**
 * Drop invalid provider/client entries so one broken nested value cannot nuke the
 * whole config. Other valid sections are preserved.
 */
function sanitizeConfig(raw: unknown): Record<string, unknown> {
  const config = { ...((raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>) };

  const providers = config.providers;
  if (providers && typeof providers === "object" && !Array.isArray(providers)) {
    const cleaned: Record<string, unknown> = {};
    for (const [id, def] of Object.entries(providers as Record<string, unknown>)) {
      const result = ProviderDefinitionSchema.safeParse(def);
      if (result.success) cleaned[id] = result.data;
      else console.error(`[config] Dropping invalid provider "${id}"`);
    }
    config.providers = cleaned;
  }

  const gateway = config.gateway;
  if (gateway && typeof gateway === "object" && !Array.isArray(gateway)) {
    const clients = (gateway as Record<string, unknown>).clients;
    if (Array.isArray(clients)) {
      const cleaned = clients.filter((client, index) => {
        if (ClientConfigSchema.safeParse(client).success) return true;
        const hint = clientConfigMigrationHint(client);
        if (hint) throw new Error(`Invalid gateway client at index ${index}: ${hint}`);
        console.error(`[config] Dropping invalid gateway client at index ${index}`);
        return false;
      });
      config.gateway = { ...(gateway as Record<string, unknown>), clients: cleaned };
    }
  }

  return config;
}

export type LoadConfigOptions = { strict?: boolean };

function loadUserConfig(sandboxPath: string, strict = false): AppConfig {
  const configPath = `${sandboxPath}/config.json`;
  if (!existsSync(configPath)) {
    if (strict) throw new Error(`config.json not found: ${configPath}`);
    const defaults = ConfigSchema.parse({});
    writeFileAtomic(configPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (strict) throw new Error(`Failed to parse ${configPath}: ${message}`);
    console.error(`[config] Failed to parse ${configPath}: ${message}`);
    return ConfigSchema.parse({});
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (strict) {
    const issues = parsed.error.issues.map(issue => `${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`);
    throw new Error(`Invalid config in ${configPath}: ${issues.join("; ")}`);
  }

  console.error(`[config] Invalid config in ${configPath}:`);
  for (const issue of parsed.error.issues) {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    console.error(`  ${path}: ${issue.message}`);
  }
  const sanitized = sanitizeConfig(raw);
  const recovered = ConfigSchema.safeParse(sanitized);
  if (recovered.success) {
    console.error(`[config] Recovered ${configPath} by dropping invalid nested entries`);
    return recovered.data;
  }
  return ConfigSchema.parse({});
}

export function loadRuntimeConfig(sandboxPath: string, strict = false): RuntimeConfig {
  const path = runtimeConfigPath(sandboxPath);
  if (!existsSync(path)) return {};
  try {
    return RuntimeConfigSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
  } catch (err) {
    if (err instanceof z.ZodError) {
      if (strict) throw new Error(`Invalid runtime config in ${path}: ${err.message}`);
      console.error(`[config] Invalid runtime config in ${path}, ignoring overlay:`);
      for (const issue of err.issues) {
        const path = issue.path.length ? issue.path.join(".") : "(root)";
        console.error(`  ${path}: ${issue.message}`);
      }
    } else {
      if (strict) throw new Error(`Failed to load ${path}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[config] Failed to load ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return {};
  }
}

export function saveRuntimeConfig(sandboxPath: string, overlay: RuntimeConfig): void {
  writeFileAtomic(runtimeConfigPath(sandboxPath), JSON.stringify(overlay, null, 2));
}

export function deleteRuntimeConfig(sandboxPath: string): void {
  const path = runtimeConfigPath(sandboxPath);
  if (existsSync(path)) rmSync(path);
}

export function loadConfig(sandboxPath: string, options: LoadConfigOptions = {}): LoadedConfig {
  const userConfig = loadUserConfig(sandboxPath, options.strict);
  const runtimeConfig = loadRuntimeConfig(sandboxPath, options.strict);
  const effective = ConfigSchema.parse(mergeConfig(userConfig, runtimeConfig));
  return { userConfig, runtimeConfig, effective };
}
