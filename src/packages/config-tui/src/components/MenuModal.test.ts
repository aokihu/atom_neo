import { describe, expect, test } from "bun:test";
import { buildMenuItems, describeSelection, MENU_KEYS } from "./MenuModal";
import { initialState } from "../wizard-logic";

function configState(overrides: Record<string, any> = {}): any {
  return { ...initialState("config"), ...overrides };
}

describe("buildMenuItems", () => {
  test("labels carry live parameter values", () => {
    const state = configState({
      theme: "dracula",
      gatewayPort: 4123,
      editedProviders: { deepseek: { models: ["m"], thinking: "disabled" }, openai: { models: [], thinking: "enabled" } },
    });
    const items = buildMenuItems(state);
    expect(items.map(i => i.label)).toEqual([
      "Providers (2)",
      "Model Profiles",
      "Theme (dracula)",
      "Gateway (port 4123)",
      "Save & Exit",
    ]);
    expect(items.map(i => i.value)).toEqual([...MENU_KEYS]);
  });
});

describe("describeSelection", () => {
  test("providers lists each provider with models and thinking", () => {
    const state = configState({
      editedProviders: {
        deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY", apiKey: "", models: ["a", "b"], thinking: "enabled", contextLimit: 131072 },
      },
    });
    const lines = describeSelection("providers", state);
    expect(lines).toEqual([
      "deepseek",
      "  models: a, b",
      "  thinking: enabled · ctx 131072",
    ]);
  });

  test("providers shows guidance when empty", () => {
    const lines = describeSelection("providers", configState());
    expect(lines.some(l => l.includes("No providers configured"))).toBe(true);
    expect(lines.some(l => l.includes("➕ Add Provider"))).toBe(true);
  });

  test("profiles shows the three mappings", () => {
    const state = configState({
      profiles: { advanced: "deepseek/v4-pro", balanced: "deepseek/v4-flash", basic: "openai/gpt-4o" },
    });
    expect(describeSelection("profiles", state)).toEqual([
      "advanced:",
      "  deepseek/v4-pro",
      "balanced:",
      "  deepseek/v4-flash",
      "basic:",
      "  openai/gpt-4o",
    ]);
  });

  test("theme shows the current theme", () => {
    expect(describeSelection("theme", configState({ theme: "nord" }))[0]).toBe("Current: nord");
  });

  test("gateway shows the current port", () => {
    expect(describeSelection("gateway", configState({ gatewayPort: 8080 }))[0]).toBe("Port: 8080");
  });

  test("save describes the write targets", () => {
    const lines = describeSelection("save", configState());
    expect(lines.some(l => l.includes("config.json"))).toBe(true);
    expect(lines.some(l => l.includes(".env"))).toBe(true);
  });

  test("all menu keys return at least one line", () => {
    for (const key of MENU_KEYS) {
      expect(describeSelection(key, configState()).length).toBeGreaterThan(0);
    }
  });
});
