import { mkdirSync, existsSync, readFileSync } from "node:fs";

// ─── Types ────────────────────────────────────────────────────────────────

export type WizardMode = "first-run" | "config";

export type ThinkingMode = "enabled" | "disabled" | "adaptive";
export type ProviderType = "llm" | "jev";

export const CONVERSATION_LEVELS = ["advanced", "balanced", "basic"] as const;
export const DEFAULT_DECISION_MODES = {
  prediction: "legacy",
  postConversation: "legacy",
  continuation: "jev",
} satisfies DecisionModes;

export type DecisionModes = {
  prediction: "legacy" | "jev";
  postConversation: "legacy" | "jev";
  continuation: "rules" | "jev";
};

export type ProviderEdit = {
  type?: ProviderType;
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
    fast?: string;
  };
  decisionMode: Partial<DecisionModes>;
  theme: string;
  gatewayPort: number;
  projectDescription: string;
  editedProviders: Record<string, ProviderEdit>;
  envKeys: Record<string, string>;
}

export const OPENROUTER_JEV = "openrouter-jev";

export const PROVIDERS: Record<string, { type?: ProviderType; apiKeyEnv: string; models: string[]; baseUrl?: string }> = {
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
    decisionMode: {},
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
  const edit: ProviderEdit = {
    ...info,
    apiKey: state.envKeys[info.apiKeyEnv] ?? "",
    models: [...info.models],
    thinking: "disabled",
  };
  return {
    state: {
      ...state,
      ...viewOf(id, edit),
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
  patch: Pick<ProviderEdit, "type" | "models" | "baseUrl" | "thinking" | "contextLimit">,
): WizardState | null {
  if (patch.models.length === 0) return null;
  const edit: ProviderEdit = { ...pending.edit, ...patch };
  if (edit.type === "jev" && !isDecisionEndpoint(edit.baseUrl)) return null;
  const editedProviders = { ...state.editedProviders, [pending.id]: edit };
  const profiles = { ...state.profiles };
  const prefix = `${pending.id}/`;
  const firstLlm = collectModelIds(editedProviders, "llm")[0];
  const firstRunProvider = state.mode === "first-run" && Object.keys(state.editedProviders).length === 0;
  for (const level of CONVERSATION_LEVELS) {
    const selected = profiles[level];
    const needsModel = firstRunProvider || (selected.startsWith(prefix)
      && (edit.type === "jev" || !edit.models.includes(selected.slice(prefix.length))));
    if (!needsModel) continue;
    if (!firstLlm) return null;
    profiles[level] = edit.type === "jev" ? firstLlm : prefix + edit.models[0];
  }
  if (profiles.fast?.startsWith(prefix) && !edit.models.includes(profiles.fast.slice(prefix.length))) {
    profiles.fast = undefined;
  }
  const envKeys = { ...state.envKeys, ...(edit.apiKeyEnv ? { [edit.apiKeyEnv]: edit.apiKey } : {}) };
  return {
    ...state,
    models: edit.models,
    customBaseUrl: edit.baseUrl,
    thinking: edit.thinking,
    contextLimit: edit.contextLimit,
    editedProviders,
    profiles,
    envKeys,
    step: state.mode === "config" ? 1 : state.step + 1, // config: back to the providers list
  };
}

/** All "provider/model" ids from finalized edits, for the profiles step. */
export function collectModelIds(editedProviders: Record<string, ProviderEdit>, type?: ProviderType): string[] {
  const ids = new Set<string>();
  for (const [id, edit] of Object.entries(editedProviders)) {
    if (type && (edit.type ?? "llm") !== type) continue;
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
  const theme = (THEMES as readonly string[]).includes(config.tui?.theme) ? config.tui.theme : "edex";
  const firstId = Object.keys(editedProviders)[0] ?? "deepseek";

  return {
    ...base,
    step: 0,
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
    ...(edit.type ? { type: edit.type } : {}),
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
  merged.providerProfiles = { ...(existing.providerProfiles ?? {}), ...state.profiles };
  if (Object.keys(state.decisionMode).length > 0) {
    merged.decisionMode = { ...(existing.decisionMode ?? {}), ...state.decisionMode };
  }
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

export function isDecisionEndpoint(value?: string): boolean {
  if (!value || !/^https?:\/\//i.test(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function parsePort(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return undefined;
  return value;
}
