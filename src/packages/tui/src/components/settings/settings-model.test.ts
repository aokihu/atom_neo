import { describe, expect, test } from "bun:test";
import { THEME_NAMES } from "@atom-neo/shared";
import { buildSettingsRows, settingsValuesFromConfig } from "./settings-model";

const config = {
  providerProfiles: {
    advanced: "deepseek/deepseek-v4-pro",
    balanced: "deepseek/deepseek-v4-flash",
    basic: "deepseek/deepseek-v4-flash",
  },
  providers: {
    deepseek: { models: ["deepseek-v4-flash"], thinking: "disabled" },
    decisions: { type: "jev", models: ["typesafe/jev-1.13"] },
  },
  tui: { theme: "edex" },
  transport: { maxOutputTokens: 8192 },
};

describe("buildSettingsRows", () => {
  test("has no rows before configuration loads", () => {
    expect(buildSettingsRows(null)).toEqual([]);
  });

  test("exposes every profile, theme, thinking and token option in order", () => {
    const rows = buildSettingsRows(config);
    expect(rows.map(row => row.key)).toEqual([
      "advanced", "balanced", "basic", "fast", "theme", "thinking", "maxTokens",
    ]);
    expect(rows.map(row => row.label)).toEqual([
      "MODEL (advanced)", "MODEL (balanced)", "MODEL (basic)", "MODEL (fast)",
      "TUI THEME", "THINKING", "MAX OUTPUT TOKENS",
    ]);
    expect(rows[4].options).toEqual([...THEME_NAMES]);
    expect(rows[5].options).toEqual(["disabled", "enabled", "adaptive"]);
    expect(rows[6].options).toEqual(["2048", "4096", "8192", "16384"]);
  });

  test("includes Jev models in the fast profile only", () => {
    const rows = buildSettingsRows(config);
    expect(rows[3].options).toContain("decisions/typesafe/jev-1.13");
    expect(rows[1].options).not.toContain("decisions/typesafe/jev-1.13");
  });
});

describe("settingsValuesFromConfig", () => {
  test("maps config with balanced fallbacks and defaults", () => {
    expect(settingsValuesFromConfig(config)).toEqual({
      advanced: "deepseek/deepseek-v4-pro",
      balanced: "deepseek/deepseek-v4-flash",
      basic: "deepseek/deepseek-v4-flash",
      fast: "deepseek/deepseek-v4-flash",
      theme: "edex",
      thinking: "disabled",
      maxTokens: "8192",
    });
  });

  test("falls back to balanced for missing profiles and uses runtime defaults", () => {
    expect(settingsValuesFromConfig({ providerProfiles: { balanced: "other/model" } })).toEqual({
      advanced: "other/model",
      balanced: "other/model",
      basic: "other/model",
      fast: "other/model",
      theme: "edex",
      thinking: "disabled",
      maxTokens: "4096",
    });
  });
});
