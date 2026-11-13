import { existsSync, readFileSync, rmSync } from "node:fs";
import { z } from "zod";
import {
  ClientConfigSchema,
  ConfigSchema,
  ProviderDefinitionSchema,
  ProviderProfilesSchema,
  RuntimeConfigSchema,
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
        console.error(`[config] Dropping invalid gateway client at index ${index}`);
        return false;
      });
      config.gateway = { ...(gateway as Record<string, unknown>), clients: cleaned };
    }
  }

  return config;
}

function loadUserConfig(sandboxPath: string): AppConfig {
  const configPath = `${sandboxPath}/config.json`;
  if (!existsSync(configPath)) {
    const defaults = ConfigSchema.parse({});
    writeFileAtomic(configPath, JSON.stringify(defaults, null, 2));
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
  const sanitized = sanitizeConfig(raw);
  const recovered = ConfigSchema.safeParse(sanitized);
  if (recovered.success) {
    console.error(`[config] Recovered ${configPath} by dropping invalid nested entries`);
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
  writeFileAtomic(runtimeConfigPath(sandboxPath), JSON.stringify(overlay, null, 2));
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
