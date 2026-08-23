import { mkdirSync, existsSync, readFileSync } from "node:fs";

// ─── Types ────────────────────────────────────────────────────────────────

export type WizardMode = "first-run" | "config";

export type ThinkingMode = "enabled" | "disabled" | "adaptive";

export type ProviderEdit = {
  apiKeyEnv: string;
  apiKey: string;
  models: string[];
  baseUrl?: string;
  thinking: ThinkingMode;
  contextLimit?: number;
};

export interface WizardState {
  step: number;
  mode: WizardMode;
  provider: string;
  apiKeyEnv: string;
  apiKey: string;
  models: string[];
  customBaseUrl?: string;
  thinking: ThinkingMode;
  contextLimit?: number;
  profiles: {
    advanced: string;
    balanced: string;
    basic: string;
  };
  theme: string;
  gatewayPort: number;
  projectDescription: string;
  editedProviders: Record<string, ProviderEdit>;
  envKeys: Record<string, string>;
}

export const PROVIDERS: Record<string, { apiKeyEnv: string; models: string[]; baseUrl?: string }> = {
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
};

export const THEMES = [
  "edex",
  "github-dark",
  "github-light",
  "dracula",
  "nord",
  "tokyo-night",
  "solarized-dark",
  "monokai",
] as const;

export const DEFAULT_PROFILES = {
  advanced: "deepseek/deepseek-v4-flash",
  balanced: "deepseek/deepseek-v4-flash",
  basic: "deepseek/deepseek-v4-flash",
};

export function initialState(mode: WizardMode = "first-run"): WizardState {
  return {
    step: 0,
    mode,
    provider: "deepseek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    apiKey: "",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    customBaseUrl: undefined,
    thinking: "disabled",
    contextLimit: undefined,
    profiles: { ...DEFAULT_PROFILES },
    theme: "edex",
    gatewayPort: 3000,
    projectDescription: "",
    editedProviders: {},
    envKeys: {},
  };
}

// ─── Pending-edit state machine (atomic rollback) ─────────────────────────

export type PendingEdit = { id: string; isNew: boolean; edit: ProviderEdit };

export function cloneEdit(edit: ProviderEdit): ProviderEdit {
  return { ...edit, models: [...edit.models] };
}

export function emptyEdit(): ProviderEdit {
  return { apiKeyEnv: "", apiKey: "", models: [], thinking: "disabled" };
}

function viewOf(id: string, edit: ProviderEdit | undefined): Partial<WizardState> {
  if (!edit) return {};
  return {
    provider: id,
    apiKeyEnv: edit.apiKeyEnv,
    apiKey: edit.apiKey,
    models: edit.models,
    customBaseUrl: edit.baseUrl,
    thinking: edit.thinking,
    contextLimit: edit.contextLimit,
  };
}

/** Start editing an existing provider (snapshot copy) or a known first-run provider. */
export function beginEdit(state: WizardState, id: string): { state: WizardState; pending: PendingEdit | null } {
  const existing = state.editedProviders[id];
  if (existing) {
    const pending: PendingEdit = { id, isNew: false, edit: cloneEdit(existing) };
    return { state: { ...state, ...viewOf(id, existing), step: state.step + 1 }, pending };
  }
  const info = PROVIDERS[id];
  if (!info) return { state, pending: null };
  const firstModel = info.models[0] ?? "";
  const edit: ProviderEdit = {
    apiKeyEnv: info.apiKeyEnv,
    apiKey: state.envKeys[info.apiKeyEnv] ?? "",
    models: [...info.models],
    thinking: "disabled",
  };
  return {
    state: {
      ...state,
      ...viewOf(id, edit),
      profiles: {
        advanced: `${id}/${firstModel}`,
        balanced: `${id}/${firstModel}`,
        basic: `${id}/${firstModel}`,
      },
      step: state.step + 1,
    },
    pending: { id, isNew: true, edit },
  };
}

/** Start editing a brand-new provider (config mode "Add Provider"). */
export function beginNewProvider(state: WizardState, id: string): { state: WizardState; pending: PendingEdit } {
  const edit = emptyEdit();
  return {
    state: { ...state, ...viewOf(id, edit), step: state.step + 1 },
    pending: { id, isNew: true, edit },
  };
}

/** Apply the API-key step to the pending edit (still not finalized). */
export function updatePendingApiKey(
  state: WizardState,
  pending: PendingEdit,
  apiKey: string,
  baseUrl?: string,
  env?: string,
): { state: WizardState; pending: PendingEdit } {
  const apiKeyEnv = env ?? pending.edit.apiKeyEnv;
  const edit: ProviderEdit = { ...pending.edit, apiKeyEnv, apiKey, baseUrl: baseUrl ?? pending.edit.baseUrl };
  return {
    state: { ...state, apiKey, apiKeyEnv, customBaseUrl: edit.baseUrl, step: state.step + 1 },
    pending: { ...pending, edit },
  };
}

/**
 * Finalize the pending edit into editedProviders. Returns null when invalid
 * (e.g. no models) — the caller keeps the pending edit untouched, so a later
 * cancel still rolls back cleanly.
 */
export function finalizeEdit(
  state: WizardState,
  pending: PendingEdit,
  patch: { models: string[]; baseUrl?: string; thinking: ThinkingMode; contextLimit?: number },
): WizardState | null {
  if (patch.models.length === 0) return null;
  const edit: ProviderEdit = { ...pending.edit, ...patch };
  const envKeys = { ...state.envKeys, ...(edit.apiKeyEnv ? { [edit.apiKeyEnv]: edit.apiKey } : {}) };
  return {
    ...state,
    models: edit.models,
    customBaseUrl: edit.baseUrl,
    thinking: edit.thinking,
    contextLimit: edit.contextLimit,
    editedProviders: { ...state.editedProviders, [pending.id]: edit },
    envKeys,
    step: state.mode === "config" ? 1 : state.step + 1, // config: back to the providers list
  };
}

/** All "provider/model" ids from finalized edits, for the profiles step. */
export function collectModelIds(editedProviders: Record<string, ProviderEdit>): string[] {
  const ids = new Set<string>();
  for (const [id, edit] of Object.entries(editedProviders)) {
    for (const model of edit.models) ids.add(`${id}/${model}`);
  }
  return [...ids].sort();
}

// ─── Prefill from sandbox files ───────────────────────────────────────────

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
  const keys: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    keys[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return keys;
}

/** Build the initial wizard state; config mode pre-fills from the existing config.json + .env. */
export function buildInitialState(mode: WizardMode, sandboxPath: string): WizardState {
  const base = initialState(mode);
  if (mode === "first-run") return base;

  const config = readJsonFile(`${sandboxPath}/config.json`) ?? {};
  const envKeys = readEnvKeys(`${sandboxPath}/.env`);

  const providersMap = (config.providers ?? {}) as Record<string, Record<string, any>>;
  const editedProviders: Record<string, ProviderEdit> = {};
  for (const [id, p] of Object.entries(providersMap)) {
    const apiKeyEnv = typeof p?.apiKeyEnv === "string" ? p.apiKeyEnv : "";
    editedProviders[id] = {
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
  };
  const theme = (THEMES as readonly string[]).includes(config.tui?.theme) ? config.tui.theme : "edex";
  const firstId = Object.keys(editedProviders)[0] ?? "deepseek";

  return {
    ...base,
    step: 0,
    provider: firstId,
    ...viewOf(firstId, editedProviders[firstId]),
    profiles,
    theme,
    gatewayPort: typeof config.gateway?.port === "number" ? config.gateway.port : 3000,
    editedProviders,
    envKeys,
  };
}

// ─── Commit ───────────────────────────────────────────────────────────────

/** Upsert the given keys into .env — existing lines are replaced, other lines (incl. old keys) are preserved. */
export function writeEnvKeys(envPath: string, keys: Record<string, string>): void {
  const lines = existsSync(envPath)
    ? readFileSync(envPath, "utf-8").replace(/\n$/, "").split("\n").filter(l => l !== "")
    : [];
  for (const [key, value] of Object.entries(keys)) {
    const idx = lines.findIndex(l => l.startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  Bun.write(envPath, lines.join("\n") + "\n");
}

function buildProviderEntry(prev: Record<string, any> | undefined, edit: ProviderEdit): Record<string, any> {
  return {
    ...(prev ?? {}),
    apiKeyEnv: edit.apiKeyEnv || prev?.apiKeyEnv || "",
    models: edit.models,
    ...(edit.baseUrl ? { baseUrl: edit.baseUrl } : {}),
    thinking: edit.thinking,
    ...(edit.contextLimit ? { contextLimit: edit.contextLimit } : {}),
  };
}

/**
 * Write config.json (per-provider merge, unknown fields preserved) + .env (upsert only).
 * Invalid provider edits (no models) are skipped so a cancelled edit can never corrupt the config.
 * first-run additionally writes AGENTS.md (when described) and the .atom/installed marker.
 */
export function commit(sandboxPath: string, state: WizardState): void {
  mkdirSync(sandboxPath, { recursive: true });

  const existing = readJsonFile(`${sandboxPath}/config.json`) ?? {};
  const prevProviders = (existing.providers ?? {}) as Record<string, Record<string, any>>;

  const merged: Record<string, any> = { ...existing };
  merged.providerProfiles = state.profiles;
  merged.providers = { ...prevProviders };
  for (const [id, edit] of Object.entries(state.editedProviders)) {
    if (edit.models.length === 0) continue;
    merged.providers[id] = buildProviderEntry(prevProviders[id], edit);
  }
  merged.tui = { theme: state.theme };
  if (state.mode === "config") {
    merged.gateway = { ...(existing.gateway ?? {}), port: state.gatewayPort ?? 3000 };
  }

  Bun.write(`${sandboxPath}/config.json`, JSON.stringify(merged, null, 2) + "\n");

  if (Object.keys(state.envKeys).length > 0) {
    writeEnvKeys(`${sandboxPath}/.env`, state.envKeys);
  }

  if (state.mode === "first-run") {
    if (state.projectDescription) {
      const template = [
        "# 项目开发指引",
        "",
        "## 代码规范",
        "- 遵循 \"Less code, more power\" 原则，代码精简干练",
        "- 避免重复创建相似功能，复用已有代码",
        "- 先思考后编写，禁止盲目编写",
        "",
        "## 项目信息",
        state.projectDescription,
        "",
      ].join("\n");
      Bun.write(`${sandboxPath}/AGENTS.md`, template);
    }
    mkdirSync(`${sandboxPath}/.atom`, { recursive: true });
    Bun.write(`${sandboxPath}/.atom/installed`, "");
  }
}

// ─── Parsers ──────────────────────────────────────────────────────────────

export function addModel(models: string[], name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return models;
  if (models.includes(trimmed)) return models;
  return [...models, trimmed];
}

export function removeModelAt(models: string[], index: number): string[] {
  if (index < 0 || index >= models.length) return models;
  return models.filter((_, i) => i !== index);
}

export function parseContextLimit(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

export function parsePort(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return undefined;
  return value;
}
