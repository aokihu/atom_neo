import { PROVIDERS } from "@atom-neo/shared";
import type { ProviderType } from "@atom-neo/shared";
import { CONVERSATION_LEVELS, viewOf } from "./wizard-state";
import type { ProviderEdit, WizardState } from "./wizard-state";
import { isDecisionEndpoint } from "./wizard-input";

// ─── Pending-edit state machine (atomic rollback) ─────────────────────────

export type PendingEdit = { id: string; isNew: boolean; edit: ProviderEdit };

export function cloneEdit(edit: ProviderEdit): ProviderEdit {
  return { ...edit, models: [...edit.models] };
}

export function emptyEdit(): ProviderEdit {
  return { apiKeyEnv: "", apiKey: "", models: [], thinking: "disabled" };
}

/** Start editing an existing provider (snapshot copy) or a known first-run provider. */
export function beginEdit(state: WizardState, id: string): { state: WizardState; pending: PendingEdit | null } {
  const existing = state.editedProviders[id];
  if (existing) {
    const pending: PendingEdit = { id, isNew: false, edit: cloneEdit(existing) };
    return { state: { ...state, ...viewOf(id, existing) }, pending };
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
    state: { ...state, ...viewOf(id, edit) },
    pending: { id, isNew: true, edit },
  };
}

/** Start editing a brand-new provider (config mode "Add Provider"). */
export function beginNewProvider(state: WizardState, id: string): { state: WizardState; pending: PendingEdit } {
  const edit = emptyEdit();
  return {
    state: { ...state, ...viewOf(id, edit) },
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
    state: { ...state, apiKey, apiKeyEnv, customBaseUrl: edit.baseUrl },
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
