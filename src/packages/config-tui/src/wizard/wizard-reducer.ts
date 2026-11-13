import type { DecisionModes } from "@atom-neo/shared";
import { buildInitialState } from "./wizard-prefill";
import type { ProviderEdit, WizardMode, WizardState } from "./wizard-state";
import { beginEdit, beginNewProvider, finalizeEdit, updatePendingApiKey } from "./wizard-edit";
import type { PendingEdit } from "./wizard-edit";

export type WizardViewKind =
  | "menu"
  | "providers"
  | "apikey"
  | "models"
  | "profiles"
  | "decisions"
  | "theme"
  | "gateway"
  | "project"
  | "confirm";

export type WizardView = { kind: WizardViewKind };

export type WizardMenuKey = "providers" | "profiles" | "decisions" | "theme" | "gateway" | "save";

export type ProviderPatch = Pick<ProviderEdit, "type" | "models" | "baseUrl" | "thinking" | "contextLimit">;
export type DecisionSettings = DecisionModes & { fast?: string };

export type WizardUiState = {
  wizard: WizardState;
  pending: PendingEdit | null;
  view: WizardView;
  quitConfirm: boolean;
  providersFromDecisions: boolean;
};

export type WizardAction =
  | { type: "menu-select"; key: WizardMenuKey }
  | { type: "providers-select"; id: string }
  | { type: "providers-add"; id: string }
  | { type: "providers-back" }
  | { type: "apikey-submit"; apiKey: string; baseUrl?: string; env?: string }
  | { type: "cancel-edit" }
  | { type: "models-submit"; patch: ProviderPatch }
  | { type: "models-cancel" }
  | { type: "profiles-submit"; profiles: WizardState["profiles"] }
  | { type: "profiles-back" }
  | { type: "decisions-submit"; settings: DecisionSettings }
  | { type: "decisions-providers"; settings: DecisionSettings }
  | { type: "decisions-back" }
  | { type: "theme-submit"; theme: string }
  | { type: "theme-back" }
  | { type: "gateway-submit"; port: number }
  | { type: "gateway-back" }
  | { type: "project-submit"; description: string }
  | { type: "project-back" }
  | { type: "confirm-back" }
  | { type: "quit-request" }
  | { type: "quit-cancel" };

export function createWizardUiState(mode: WizardMode, sandboxPath: string): WizardUiState {
  return {
    wizard: buildInitialState(mode, sandboxPath),
    pending: null,
    view: { kind: mode === "config" ? "menu" : "providers" },
    quitConfirm: false,
    providersFromDecisions: false,
  };
}

export function allowDecisionProviders(state: Pick<WizardUiState, "wizard" | "providersFromDecisions">): boolean {
  return state.wizard.mode === "config" || state.providersFromDecisions;
}

/** The visible view; quit confirmation and mode guards suppress the underlying view. */
export function resolveView(state: WizardUiState): WizardView | null {
  if (state.quitConfirm) return null;
  const { kind } = state.view;
  if ((kind === "menu" || kind === "gateway") && state.wizard.mode !== "config") return null;
  if (kind === "project" && state.wizard.mode !== "first-run") return null;
  return state.view;
}

function view(state: WizardUiState, kind: WizardViewKind): WizardUiState {
  return { ...state, view: { kind } };
}

function modeView(state: WizardUiState, config: WizardViewKind, firstRun: WizardViewKind): WizardUiState {
  return view(state, state.wizard.mode === "config" ? config : firstRun);
}

function applyDecisions(wizard: WizardState, settings: DecisionSettings): WizardState {
  const { fast, ...decisionMode } = settings;
  return { ...wizard, profiles: { ...wizard.profiles, fast }, decisionMode };
}

export function wizardReducer(state: WizardUiState, action: WizardAction): WizardUiState {
  switch (action.type) {
    case "menu-select":
      return view(state, action.key === "save" ? "confirm" : action.key);

    case "providers-select": {
      const next = beginEdit(state.wizard, action.id);
      if (!next.pending) return state;
      return { ...state, wizard: next.state, pending: next.pending, view: { kind: "apikey" } };
    }

    case "providers-add": {
      const next = beginNewProvider(state.wizard, action.id);
      return { ...state, wizard: next.state, pending: next.pending, view: { kind: "apikey" } };
    }

    case "providers-back":
      if (state.providersFromDecisions) {
        return { ...state, providersFromDecisions: false, view: { kind: "decisions" } };
      }
      if (state.wizard.mode === "config") return view(state, "menu");
      return { ...state, quitConfirm: true };

    case "apikey-submit": {
      if (!state.pending) return state;
      const next = updatePendingApiKey(state.wizard, state.pending, action.apiKey, action.baseUrl, action.env);
      return { ...state, wizard: next.state, pending: next.pending, view: { kind: "models" } };
    }

    case "cancel-edit":
      return { ...state, pending: null, view: { kind: "providers" } };

    case "models-submit": {
      if (!state.pending) return state;
      const wizard = finalizeEdit(state.wizard, state.pending, action.patch);
      if (!wizard) return state;
      return {
        ...state,
        wizard,
        pending: null,
        view: { kind: allowDecisionProviders(state) ? "providers" : "profiles" },
      };
    }

    case "models-cancel":
      if (state.wizard.mode === "config") return { ...state, pending: null, view: { kind: "providers" } };
      return view(state, "apikey");

    case "profiles-submit":
      return modeView({ ...state, wizard: { ...state.wizard, profiles: action.profiles } }, "menu", "decisions");

    case "profiles-back":
      return modeView(state, "menu", "providers");

    case "decisions-submit":
      return modeView({ ...state, wizard: applyDecisions(state.wizard, action.settings) }, "menu", "theme");

    case "decisions-providers":
      return {
        ...state,
        wizard: applyDecisions(state.wizard, action.settings),
        providersFromDecisions: true,
        view: { kind: "providers" },
      };

    case "decisions-back":
      return modeView(state, "menu", "profiles");

    case "theme-submit":
      return modeView({ ...state, wizard: { ...state.wizard, theme: action.theme } }, "menu", "project");

    case "theme-back":
      return modeView(state, "menu", "decisions");

    case "gateway-submit":
      return view({ ...state, wizard: { ...state.wizard, gatewayPort: action.port } }, "menu");

    case "gateway-back":
      return view(state, "menu");

    case "project-submit":
      return view({ ...state, wizard: { ...state.wizard, projectDescription: action.description } }, "confirm");

    case "project-back":
      return view(state, "theme");

    case "confirm-back":
      return modeView(state, "menu", "project");

    case "quit-request":
      return { ...state, quitConfirm: true };

    case "quit-cancel":
      return { ...state, quitConfirm: false };
  }
}
