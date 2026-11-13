import { describe, expect, test } from "bun:test";
import { initialState } from "./wizard-state";
import type { WizardMode } from "./wizard-state";
import { allowDecisionProviders, wizardReducer } from "./wizard-reducer";
import type { WizardAction, WizardUiState } from "./wizard-reducer";

function ui(mode: WizardMode = "config", overrides: Partial<WizardUiState> = {}): WizardUiState {
  return {
    wizard: initialState(mode),
    pending: null,
    view: { kind: mode === "config" ? "menu" : "providers" },
    quitConfirm: false,
    providersFromDecisions: false,
    ...overrides,
  };
}

const dispatch = (state: WizardUiState, action: WizardAction) => wizardReducer(state, action);
const patch = { models: ["deepseek-v4-flash"], thinking: "disabled" as const };
const decisions = { prediction: "jev", postConversation: "jev", continuation: "jev", fast: "deepseek/deepseek-v4-flash" } as const;

describe("provider navigation", () => {
  test("selecting an unknown provider leaves the UI untouched", () => {
    const state = ui();
    expect(dispatch(state, { type: "providers-select", id: "missing" })).toBe(state);
  });

  test("selecting a known provider snapshots it and opens the key step", () => {
    const state = ui();
    const next = dispatch(state, { type: "providers-select", id: "deepseek" });
    expect(next.view).toEqual({ kind: "apikey" });
    expect(next.pending).toMatchObject({ id: "deepseek", isNew: true });
    expect(next.wizard.provider).toBe("deepseek");
    expect(next.wizard.editedProviders).toEqual({});
  });

  test("adding a provider opens the key step with an empty edit", () => {
    const next = dispatch(ui(), { type: "providers-add", id: "volengine" });
    expect(next.view).toEqual({ kind: "apikey" });
    expect(next.pending).toEqual({
      id: "volengine",
      isNew: true,
      edit: { apiKeyEnv: "", apiKey: "", models: [], thinking: "disabled" },
    });
  });

  test("providers-back follows config, decisions, and first-run quit paths", () => {
    expect(dispatch(ui("config"), { type: "providers-back" }).view).toEqual({ kind: "menu" });

    const fromDecisions = dispatch(ui("first-run", { providersFromDecisions: true }), { type: "providers-back" });
    expect(fromDecisions.view).toEqual({ kind: "decisions" });
    expect(fromDecisions.providersFromDecisions).toBe(false);

    expect(dispatch(ui("first-run"), { type: "providers-back" }).quitConfirm).toBe(true);
  });
});

describe("pending edit", () => {
  test("apikey-submit without a pending edit is a no-op", () => {
    const state = ui();
    expect(dispatch(state, { type: "apikey-submit", apiKey: "sk" })).toBe(state);
  });

  test("apikey-submit updates the pending edit and opens models", () => {
    const state = dispatch(ui(), { type: "providers-add", id: "custom" });
    const next = dispatch(state, { type: "apikey-submit", apiKey: "sk", env: "CUSTOM_KEY" });
    expect(next.view).toEqual({ kind: "models" });
    expect(next.pending?.edit).toMatchObject({ apiKey: "sk", apiKeyEnv: "CUSTOM_KEY" });
    expect(next.wizard.apiKey).toBe("sk");
  });

  test("cancel-edit drops the pending edit and returns to providers", () => {
    const state = dispatch(ui(), { type: "providers-add", id: "custom" });
    const next = dispatch(state, { type: "cancel-edit" });
    expect(next.pending).toBeNull();
    expect(next.view).toEqual({ kind: "providers" });
  });

  test("models-submit rejects invalid edits without touching the pending state", () => {
    const state = dispatch(ui(), { type: "providers-add", id: "custom" });
    const next = dispatch(state, { type: "models-submit", patch: { ...patch, models: [] } });
    expect(next).toBe(state);
    expect(next.pending).not.toBeNull();
  });

  test("models-submit lands the edit and picks the next view per mode", () => {
    const config = dispatch(ui("config"), { type: "providers-add", id: "custom" });
    const configNext = dispatch(config, { type: "models-submit", patch });
    expect(configNext.view).toEqual({ kind: "providers" });
    expect(configNext.pending).toBeNull();
    expect(configNext.wizard.editedProviders.custom.models).toEqual(["deepseek-v4-flash"]);

    const firstRun = dispatch(ui("first-run"), { type: "providers-add", id: "custom" });
    expect(dispatch(firstRun, { type: "models-submit", patch }).view).toEqual({ kind: "profiles" });

    const viaDecisions = { ...firstRun, providersFromDecisions: true };
    expect(dispatch(viaDecisions, { type: "models-submit", patch }).view).toEqual({ kind: "providers" });
  });

  test("models-cancel rolls back in config and steps back in first-run", () => {
    const config = dispatch(ui("config"), { type: "providers-add", id: "custom" });
    const configNext = dispatch(config, { type: "models-cancel" });
    expect(configNext.pending).toBeNull();
    expect(configNext.view).toEqual({ kind: "providers" });

    const firstRun = dispatch(ui("first-run"), { type: "providers-add", id: "custom" });
    const firstRunNext = dispatch(firstRun, { type: "models-cancel" });
    expect(firstRunNext.pending).not.toBeNull();
    expect(firstRunNext.view).toEqual({ kind: "apikey" });
  });
});

describe("wizard field updates", () => {
  test("profiles-submit stores profiles and continues", () => {
    const profiles = { advanced: "a/m", balanced: "a/m", basic: "a/m" };
    const config = dispatch(ui("config"), { type: "profiles-submit", profiles });
    expect(config.wizard.profiles).toEqual(profiles);
    expect(config.view).toEqual({ kind: "menu" });

    expect(dispatch(ui("first-run"), { type: "profiles-submit", profiles }).view).toEqual({ kind: "decisions" });
  });

  test("decisions submissions store modes and fast profile", () => {
    const next = dispatch(ui("config"), { type: "decisions-submit", settings: decisions });
    expect(next.wizard.profiles.fast).toBe("deepseek/deepseek-v4-flash");
    expect(next.wizard.decisionMode).toEqual({
      prediction: "jev", postConversation: "jev", continuation: "jev",
    });
    expect(next.view).toEqual({ kind: "menu" });

    const viaProviders = dispatch(ui("first-run"), { type: "decisions-providers", settings: decisions });
    expect(viaProviders.providersFromDecisions).toBe(true);
    expect(viaProviders.view).toEqual({ kind: "providers" });
  });

  test("decisions can clear the fast profile", () => {
    const state = ui("config", { wizard: { ...initialState("config"), profiles: { ...initialState("config").profiles, fast: "x/y" } } });
    const next = dispatch(state, { type: "decisions-submit", settings: { ...decisions, fast: undefined } });
    expect(next.wizard.profiles.fast).toBeUndefined();
  });

  test("theme, gateway, and project submissions update their fields", () => {
    const theme = dispatch(ui("first-run"), { type: "theme-submit", theme: "nord" });
    expect(theme.wizard.theme).toBe("nord");
    expect(theme.view).toEqual({ kind: "project" });

    const gateway = dispatch(ui("config"), { type: "gateway-submit", port: 4123 });
    expect(gateway.wizard.gatewayPort).toBe(4123);
    expect(gateway.view).toEqual({ kind: "menu" });

    const project = dispatch(ui("first-run"), { type: "project-submit", description: "demo" });
    expect(project.wizard.projectDescription).toBe("demo");
    expect(project.view).toEqual({ kind: "confirm" });
  });

  test("quit actions toggle only the confirmation flag", () => {
    const requested = dispatch(ui("config"), { type: "quit-request" });
    expect(requested.quitConfirm).toBe(true);
    expect(requested.view).toEqual({ kind: "menu" });
    expect(dispatch(requested, { type: "quit-cancel" }).quitConfirm).toBe(false);
  });
});

describe("allowDecisionProviders", () => {
  test("config always allows decisions providers; first-run only when entered from decisions", () => {
    expect(allowDecisionProviders(ui("config"))).toBe(true);
    expect(allowDecisionProviders(ui("first-run"))).toBe(false);
    expect(allowDecisionProviders(ui("first-run", { providersFromDecisions: true }))).toBe(true);
  });
});
