import { DEFAULT_PROFILES, DEFAULT_THEME, PROVIDERS } from "@atom-neo/shared";
import type { DecisionModes, ProviderProtocol, ProviderType, ThinkingMode } from "@atom-neo/shared";

// ─── Types ────────────────────────────────────────────────────────────────

export type WizardMode = "first-run" | "config";

export const CONVERSATION_LEVELS = ["advanced", "balanced", "basic"] as const;

export type ProviderEdit = {
  type?: ProviderType;
  protocol?: ProviderProtocol;
  apiKeyEnv: string;
  apiKey: string;
  models: string[];
  baseUrl?: string;
  thinking: ThinkingMode;
  contextLimit?: number;
};

export interface WizardState {
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

export function initialState(mode: WizardMode = "first-run"): WizardState {
  const preset = PROVIDERS.deepseek;
  return {
    mode,
    provider: "deepseek",
    apiKeyEnv: preset.apiKeyEnv,
    apiKey: "",
    models: [...preset.models],
    customBaseUrl: undefined,
    thinking: "disabled",
    contextLimit: undefined,
    profiles: { ...DEFAULT_PROFILES },
    decisionMode: {},
    theme: DEFAULT_THEME,
    gatewayPort: 3000,
    projectDescription: "",
    editedProviders: {},
    envKeys: {},
  };
}

/** Project a provider edit onto the wizard's flat editing fields. */
export function viewOf(id: string, edit: ProviderEdit | undefined): Partial<WizardState> {
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


