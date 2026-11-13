import { describe, expect, test } from "bun:test";
import { initialState } from "./wizard-state";
import type { WizardMode } from "./wizard-state";
import { createWizardUiState, resolveView, wizardReducer } from "./wizard-reducer";
import type { WizardAction, WizardUiState, WizardViewKind } from "./wizard-reducer";

function ui(mode: WizardMode, overrides: Partial<WizardUiState> = {}): WizardUiState {
  return {
    wizard: initialState(mode),
    pending: null,
    view: { kind: mode === "config" ? "menu" : "providers" },
    quitConfirm: false,
    providersFromDecisions: false,
    ...overrides,
  };
}

const run = (state: WizardUiState, ...actions: WizardAction[]) =>
  actions.reduce(wizardReducer, state);
const kind = (state: WizardUiState): WizardViewKind | undefined => resolveView(state)?.kind;

const modelPatch = { models: ["deepseek-v4-flash"], thinking: "disabled" as const };
const decisions = { prediction: "jev", postConversation: "jev", continuation: "jev", fast: "deepseek/deepseek-v4-flash" } as const;

describe("view transitions", () => {
  test("config mode walks menu → providers → key → models → menu steps", () => {
    let state = ui("config");
    expect(kind(state)).toBe("menu");

    state = run(state, { type: "menu-select", key: "providers" });
    expect(kind(state)).toBe("providers");

    state = run(state, { type: "providers-select", id: "deepseek" });
    expect(kind(state)).toBe("apikey");

    state = run(state, { type: "apikey-submit", apiKey: "sk-x" });
    expect(kind(state)).toBe("models");

    state = run(state, { type: "models-submit", patch: modelPatch });
    expect(kind(state)).toBe("providers");

    state = run(state, { type: "providers-back" });
    expect(kind(state)).toBe("menu");
  });

  test("config mode menu targets map directly to views", () => {
    const expected = {
      providers: "providers",
      profiles: "profiles",
      decisions: "decisions",
      theme: "theme",
      gateway: "gateway",
      save: "confirm",
    } as const;
    for (const [key, target] of Object.entries(expected)) {
      const state = run(ui("config"), { type: "menu-select", key: key as keyof typeof expected });
      expect(kind(state)).toBe(target);
    }
  });

  test("first-run mode walks providers → key → models → profiles → decisions → theme → project → confirm", () => {
    let state = ui("first-run");
    const trail: (WizardViewKind | undefined)[] = [kind(state)];

    state = run(state, { type: "providers-select", id: "deepseek" });
    trail.push(kind(state));
    state = run(state, { type: "apikey-submit", apiKey: "sk-x" });
    trail.push(kind(state));
    state = run(state, { type: "models-submit", patch: modelPatch });
    trail.push(kind(state));
    state = run(state, { type: "profiles-submit", profiles: state.wizard.profiles });
    trail.push(kind(state));
    state = run(state, { type: "decisions-submit", settings: decisions });
    trail.push(kind(state));
    state = run(state, { type: "theme-submit", theme: "nord" });
    trail.push(kind(state));
    state = run(state, { type: "project-submit", description: "demo" });
    trail.push(kind(state));

    expect(trail).toEqual([
      "providers", "apikey", "models", "profiles", "decisions", "theme", "project", "confirm",
    ]);
  });

  test("back paths mirror the forward path in both modes", () => {
    expect(kind(run(ui("config"), { type: "profiles-back" }))).toBe("menu");
    expect(kind(run(ui("config"), { type: "decisions-back" }))).toBe("menu");
    expect(kind(run(ui("config"), { type: "theme-back" }))).toBe("menu");
    expect(kind(run(ui("config"), { type: "gateway-back" }))).toBe("menu");
    expect(kind(run(ui("config"), { type: "confirm-back" }))).toBe("menu");

    expect(kind(run(ui("first-run"), { type: "profiles-back" }))).toBe("providers");
    expect(kind(run(ui("first-run"), { type: "decisions-back" }))).toBe("profiles");
    expect(kind(run(ui("first-run"), { type: "theme-back" }))).toBe("decisions");
    expect(kind(run(ui("first-run"), { type: "project-back" }))).toBe("theme");
    expect(kind(run(ui("first-run"), { type: "confirm-back" }))).toBe("project");
  });

  test("quit confirmation hides the current view and cancel restores it", () => {
    let state = run(ui("config"), { type: "menu-select", key: "theme" });
    state = run(state, { type: "quit-request" });
    expect(resolveView(state)).toBeNull();
    state = run(state, { type: "quit-cancel" });
    expect(kind(state)).toBe("theme");
  });

  test("resolveView suppresses views that do not belong to the mode", () => {
    expect(resolveView(ui("first-run", { view: { kind: "menu" } }))).toBeNull();
    expect(resolveView(ui("first-run", { view: { kind: "gateway" } }))).toBeNull();
    expect(resolveView(ui("config", { view: { kind: "project" } }))).toBeNull();
    expect(kind(ui("first-run", { view: { kind: "gateway" }, quitConfirm: false }))).toBeUndefined();
  });
});

describe("initial state", () => {
  test("starts on menu for config and providers for first-run", () => {
    expect(createWizardUiState("config", "/nonexistent-atom-wizard").view).toEqual({ kind: "menu" });
    expect(createWizardUiState("first-run", "/nonexistent-atom-wizard").view).toEqual({ kind: "providers" });
  });
});
