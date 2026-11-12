import { DEFAULT_THEME, THEME_NAMES } from "@atom-neo/shared";
import type { ServerInfo } from "../../types";

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

export const PROFILE_LEVELS = ["advanced", "balanced", "basic", "fast"] as const;
export const THINKING_OPTIONS = ["disabled", "enabled", "adaptive"];
export const MAX_TOKEN_OPTIONS = [2048, 4096, 8192, 16384];

export type RowKey = "advanced" | "balanced" | "basic" | "fast" | "theme" | "thinking" | "maxTokens";

export type SettingsRow = { key: RowKey; label: string; options: string[] };

export function headers(token?: string): Record<string, string> {
  return token ? { "x-atom-admin-token": token } : {};
}

export function modelOptions(config: Record<string, any>, includeJev = false): string[] {
  const options: string[] = [];
  for (const [provider, def] of Object.entries(config.providers ?? {})) {
    if (!includeJev && (def as any)?.type === "jev") continue;
    for (const model of (def as any)?.models ?? []) options.push(`${provider}/${model}`);
  }
  if (options.length === 0) {
    options.push(config.providerProfiles?.balanced ?? DEFAULT_MODEL);
  }
  return [...new Set(options)].sort();
}

export function serverInfoFromConfig(prev: ServerInfo, config: Record<string, any>): ServerInfo {
  const balanced: string = config.providerProfiles?.balanced ?? DEFAULT_MODEL;
  const sep = balanced.indexOf("/");
  const provider = sep >= 0 ? balanced.slice(0, sep) : "deepseek";
  const model = sep >= 0 ? balanced.slice(sep + 1) : balanced;
  return {
    ...prev,
    model,
    theme: config.tui?.theme ?? prev.theme,
    thinking: config.providers?.[provider]?.thinking ?? "disabled",
  };
}

export function buildRuntimePatch(
  values: Record<RowKey, string>,
  config: Record<string, any>,
): Record<string, unknown> {
  const balanced = values.balanced || DEFAULT_MODEL;
  const provider = balanced.includes("/") ? balanced.split("/")[0] : "deepseek";
  const body: Record<string, unknown> = {};

  const profiles: Record<string, string> = {};
  for (const level of PROFILE_LEVELS) {
    const previous = config.providerProfiles?.[level] ?? (level === "fast" ? config.providerProfiles?.basic : undefined);
    if (values[level] && values[level] !== previous) profiles[level] = values[level];
  }
  if (Object.keys(profiles).length > 0) body.providerProfiles = profiles;
  if (values.theme !== config.tui?.theme) body.tui = { theme: values.theme };
  if (values.thinking !== (config.providers?.[provider]?.thinking ?? "disabled")) {
    body.providers = { [provider]: { thinking: values.thinking } };
  }
  if (values.maxTokens !== String(config.transport?.maxOutputTokens ?? 4096)) {
    body.transport = { maxOutputTokens: Number(values.maxTokens) };
  }
  return body;
}

export function buildSettingsRows(config: Record<string, any> | null): SettingsRow[] {
  if (!config) return [];
  const options = modelOptions(config);
  return [
    ...PROFILE_LEVELS.map(level => ({
      key: level as RowKey,
      label: `MODEL (${level})`,
      options: level === "fast" ? modelOptions(config, true) : options,
    })),
    { key: "theme" as RowKey, label: "TUI THEME", options: [...THEME_NAMES] },
    { key: "thinking" as RowKey, label: "THINKING", options: THINKING_OPTIONS },
    { key: "maxTokens" as RowKey, label: "MAX OUTPUT TOKENS", options: MAX_TOKEN_OPTIONS.map(String) },
  ];
}

export function settingsValuesFromConfig(config: Record<string, any>): Record<RowKey, string> {
  const balanced: string = config.providerProfiles?.balanced ?? DEFAULT_MODEL;
  const provider = balanced.includes("/") ? balanced.split("/")[0] : "deepseek";
  return {
    advanced: config.providerProfiles?.advanced ?? balanced,
    balanced,
    basic: config.providerProfiles?.basic ?? balanced,
    fast: config.providerProfiles?.fast ?? config.providerProfiles?.basic ?? balanced,
    theme: config.tui?.theme ?? DEFAULT_THEME,
    thinking: config.providers?.[provider]?.thinking ?? "disabled",
    maxTokens: String(config.transport?.maxOutputTokens ?? 4096),
  };
}
