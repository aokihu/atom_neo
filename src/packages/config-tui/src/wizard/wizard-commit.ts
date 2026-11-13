import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { upsertEnv, writeFileAtomic } from "@atom-neo/shared";
import { readJsonFile } from "./wizard-prefill";
import type { ProviderEdit, WizardState } from "./wizard-state";

/** Upsert the given keys into .env — existing lines are replaced, other lines (incl. old keys) are preserved. */
export function writeEnvKeys(envPath: string, keys: Record<string, string>): void {
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  writeFileAtomic(envPath, upsertEnv(existing, keys));
}

function buildProviderEntry(prev: Record<string, any> | undefined, edit: ProviderEdit): Record<string, any> {
  return {
    ...(prev ?? {}),
    ...(edit.type ? { type: edit.type } : {}),
    ...(edit.protocol ? { protocol: edit.protocol } : {}),
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
  merged.tui = { ...(existing.tui ?? {}), theme: state.theme };
  if (state.mode === "config") {
    merged.gateway = { ...(existing.gateway ?? {}), port: state.gatewayPort ?? 3000 };
  }

  writeFileAtomic(`${sandboxPath}/config.json`, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });

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
      writeFileAtomic(`${sandboxPath}/AGENTS.md`, template);
    }
    mkdirSync(`${sandboxPath}/.atom`, { recursive: true });
    writeFileAtomic(`${sandboxPath}/.atom/installed`, "");
  }
}
