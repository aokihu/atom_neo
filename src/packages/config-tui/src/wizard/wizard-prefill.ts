import { existsSync, readFileSync } from "node:fs";
import {
  DEFAULT_PROFILES,
  DEFAULT_THEME,
  PROVIDER_PROTOCOLS,
  isThemeName,
  parseEnv,
} from "@atom-neo/shared";
import type { DecisionModes, ProviderProtocol, ThinkingMode } from "@atom-neo/shared";
import { initialState, viewOf } from "./wizard-state";
import type { ProviderEdit, WizardMode, WizardState } from "./wizard-state";

export function readJsonFile(path: string): Record<string, any> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Parse KEY=VALUE lines from a .env file (comments and blanks ignored). */
export function readEnvKeys(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {};
  return parseEnv(readFileSync(envPath, "utf-8"));
}

/** Build the initial wizard state; config mode pre-fills from the existing config.json + .env. */
export function buildInitialState(mode: WizardMode, sandboxPath: string): WizardState {
  const base = initialState(mode);
  const config = readJsonFile(`${sandboxPath}/config.json`) ?? {};
  const decisionMode: Partial<DecisionModes> = {};
  const { prediction, postConversation, continuation } = config.decisionMode ?? {};
  if (prediction === "legacy" || prediction === "jev") decisionMode.prediction = prediction;
  if (postConversation === "legacy" || postConversation === "jev") decisionMode.postConversation = postConversation;
  if (continuation === "rules" || continuation === "jev") decisionMode.continuation = continuation;
  const fast = typeof config.providerProfiles?.fast === "string" ? config.providerProfiles.fast : undefined;
  if (mode === "first-run") return { ...base, profiles: { ...base.profiles, fast }, decisionMode };

  const envKeys = readEnvKeys(`${sandboxPath}/.env`);

  const providersMap = (config.providers ?? {}) as Record<string, Record<string, any>>;
  const editedProviders: Record<string, ProviderEdit> = {};
  for (const [id, p] of Object.entries(providersMap)) {
    const apiKeyEnv = typeof p?.apiKeyEnv === "string" ? p.apiKeyEnv : "";
    editedProviders[id] = {
      ...(p?.type === "jev" || p?.type === "llm" ? { type: p.type } : {}),
      ...(typeof p?.protocol === "string" && (PROVIDER_PROTOCOLS as readonly string[]).includes(p.protocol)
        ? { protocol: p.protocol as ProviderProtocol }
        : {}),
      apiKeyEnv,
      apiKey: envKeys[apiKeyEnv] ?? "",
      models: Array.isArray(p?.models) ? p.models : [],
      baseUrl: typeof p?.baseUrl === "string" ? p.baseUrl : undefined,
      thinking: (["enabled", "disabled", "adaptive"] as ThinkingMode[]).includes(p?.thinking) ? p.thinking : "disabled",
      contextLimit: typeof p?.contextLimit === "number" ? p.contextLimit : undefined,
    };
  }

  const profiles = {
    advanced: config.providerProfiles?.advanced ?? DEFAULT_PROFILES.advanced,
    balanced: config.providerProfiles?.balanced ?? DEFAULT_PROFILES.balanced,
    basic: config.providerProfiles?.basic ?? DEFAULT_PROFILES.basic,
    fast,
  };
  const theme = isThemeName(config.tui?.theme) ? config.tui.theme : DEFAULT_THEME;
  const firstId = Object.keys(editedProviders)[0] ?? "deepseek";

  return {
    ...base,
    provider: firstId,
    ...viewOf(firstId, editedProviders[firstId]),
    profiles,
    decisionMode,
    theme,
    gatewayPort: typeof config.gateway?.port === "number" ? config.gateway.port : 3000,
    editedProviders,
    envKeys,
  };
}
