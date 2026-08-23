import { describe, expect, test } from "bun:test";
import { modelOptions, serverInfoFromConfig, buildRuntimePatch } from "./SettingsModal";
import type { ServerInfo } from "../types";

const baseInfo: ServerInfo = {
  port: 3100,
  host: "127.0.0.1",
  model: "deepseek-v4-flash",
  sandbox: "/tmp/sandbox",
  version: "1.14.0",
  tools: [],
  theme: "edex",
  thinking: "disabled",
};

const baseConfig = {
  providerProfiles: {
    advanced: "deepseek/deepseek-v4-pro",
    balanced: "deepseek/deepseek-v4-flash",
    basic: "deepseek/deepseek-v4-flash",
  },
  providers: {
    deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY", models: ["deepseek-v4-pro", "deepseek-v4-flash"], thinking: "disabled" },
  },
  tui: { theme: "edex" },
  transport: { maxOutputTokens: 4096 },
};

describe("modelOptions", () => {
  test("flattens provider models into provider/model ids", () => {
    expect(modelOptions(baseConfig)).toEqual([
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
    ]);
  });

  test("falls back to the balanced profile when no providers are configured", () => {
    expect(modelOptions({ providers: {}, providerProfiles: { balanced: "deepseek/deepseek-v4-flash" } }))
      .toEqual(["deepseek/deepseek-v4-flash"]);
  });
});

describe("serverInfoFromConfig", () => {
  test("maps effective config back to server info", () => {
    const info = serverInfoFromConfig(baseInfo, {
      ...baseConfig,
      providerProfiles: { ...baseConfig.providerProfiles, balanced: "deepseek/deepseek-v4-pro" },
      providers: { deepseek: { ...baseConfig.providers.deepseek, thinking: "enabled" } },
      tui: { theme: "dracula" },
    });
    expect(info.model).toBe("deepseek-v4-pro");
    expect(info.thinking).toBe("enabled");
    expect(info.theme).toBe("dracula");
  });

  test("keeps previous values when config omits them", () => {
    const info = serverInfoFromConfig(baseInfo, { providerProfiles: { balanced: "deepseek/deepseek-v4-flash" } });
    expect(info.theme).toBe("edex");
    expect(info.thinking).toBe("disabled");
  });
});

describe("buildRuntimePatch", () => {
  const unchangedValues = {
    advanced: "deepseek/deepseek-v4-pro",
    balanced: "deepseek/deepseek-v4-flash",
    basic: "deepseek/deepseek-v4-flash",
    theme: "edex",
    thinking: "disabled",
    maxTokens: "4096",
  };

  test("returns an empty patch when nothing changed", () => {
    expect(buildRuntimePatch(unchangedValues, baseConfig)).toEqual({});
  });

  test("collects only changed top-level fields", () => {
    const patch = buildRuntimePatch({
      ...unchangedValues,
      balanced: "deepseek/deepseek-v4-pro",
      theme: "dracula",
      maxTokens: "8192",
    }, baseConfig);
    expect(patch).toEqual({
      providerProfiles: { balanced: "deepseek/deepseek-v4-pro" },
      tui: { theme: "dracula" },
      transport: { maxOutputTokens: 8192 },
    });
  });

  test("patches thinking via the balanced profile provider", () => {
    const patch = buildRuntimePatch({ ...unchangedValues, thinking: "enabled" }, baseConfig);
    expect(patch).toEqual({ providers: { deepseek: { thinking: "enabled" } } });
  });
});
