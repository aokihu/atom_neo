import { describe, expect, test } from "bun:test";
import { ClientConfigSchema } from "./client";
import { DEFAULT_PROFILES, PROVIDERS, ProviderDefinitionSchema, ProviderProfilesSchema } from "./providers";
import { ConfigSchema, RuntimeConfigSchema, mergeConfig, overlaySchema } from "./schema";
import { DEFAULT_THEME, THEME_NAMES, isThemeName } from "./theme";

describe("ConfigSchema defaults", () => {
  test("parses an empty object with stable defaults", () => {
    const config = ConfigSchema.parse({});
    expect(config.version).toBe(2);
    expect(config.providerProfiles).toEqual({ ...DEFAULT_PROFILES });
    expect(config.providers).toEqual({});
    expect(config.decisionMode).toEqual({ prediction: "legacy", postConversation: "legacy", continuation: "jev" });
    expect(config.transport.maxOutputTokens).toBe(4096);
    expect(config.gateway).toEqual({ port: 3000, clients: [] });
    expect(config.tui.theme).toBe(DEFAULT_THEME);
    expect(config.conversation.maxGlobalRounds).toBe(100);
  });

  test("ignores the legacy top-level theme field", () => {
    const config = ConfigSchema.parse({ theme: "dark" });
    expect("theme" in config).toBe(false);
    expect(config.tui.theme).toBe(DEFAULT_THEME);
  });

  test("provider profiles fall back to DEFAULT_PROFILES and accept fast", () => {
    expect(ProviderProfilesSchema.parse({})).toEqual({ ...DEFAULT_PROFILES });
    expect(ProviderProfilesSchema.parse({ fast: "openrouter-jev/typesafe/jev-1.13" }).fast)
      .toBe("openrouter-jev/typesafe/jev-1.13");
  });

  test("provider definitions default to llm/disabled and require models", () => {
    expect(ProviderDefinitionSchema.parse({ apiKeyEnv: "X", models: ["m"] })).toEqual({
      type: "llm",
      apiKeyEnv: "X",
      models: ["m"],
      thinking: "disabled",
    });
    expect(() => ProviderDefinitionSchema.parse({ apiKeyEnv: "X", models: [] })).toThrow();
  });
});

describe("theme contract", () => {
  test("every shared theme name validates", () => {
    for (const name of THEME_NAMES) {
      expect(ConfigSchema.parse({ tui: { theme: name } }).tui.theme).toBe(name);
      expect(isThemeName(name)).toBe(true);
    }
  });

  test("rejects unknown themes", () => {
    expect(() => ConfigSchema.parse({ tui: { theme: "neon" } })).toThrow();
    expect(() => RuntimeConfigSchema.parse({ tui: { theme: "neon" } })).toThrow();
    expect(isThemeName("neon")).toBe(false);
    expect(isThemeName(undefined)).toBe(false);
  });

  test("exposes the wizard presets from one source", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(["custom", "deepseek", "openai", "openrouter-jev"]);
    expect(PROVIDERS.deepseek.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
    expect(PROVIDERS["openrouter-jev"].type).toBe("jev");
    expect(PROVIDERS.custom.models).toEqual([]);
  });
});

describe("ClientConfigSchema", () => {
  test("defaults stdio and requires id/platform/binary", () => {
    expect(ClientConfigSchema.parse({ id: "bot", platform: "telegram", binary: "./bot" })).toEqual({
      id: "bot",
      platform: "telegram",
      binary: "./bot",
      stdio: "inherit",
    });
    expect(() => ClientConfigSchema.parse({ id: "", platform: "telegram", binary: "./bot" })).toThrow();
    expect(() => ClientConfigSchema.parse({ id: "bot" })).toThrow();
  });

  test("user config embeds the shared client entry schema", () => {
    const config = ConfigSchema.parse({
      gateway: { clients: [{ id: "bot", platform: "telegram", binary: "./bot", clientArgs: { token: "x" } }] },
    });
    expect(config.gateway.clients[0]).toEqual({
      id: "bot",
      platform: "telegram",
      binary: "./bot",
      clientArgs: { token: "x" },
      stdio: "inherit",
    });
  });
});

describe("mergeConfig", () => {
  test("overlay wins for primitives, recurses into objects, replaces arrays", () => {
    const base = { a: 1, tui: { theme: "edex" }, log: { ignore: ["debug"] }, providers: { deepseek: { models: ["a"] } } };
    const overlay = { a: 2, tui: { theme: "nord" }, log: { ignore: ["info"] }, providers: { deepseek: { models: ["b"] } } };
    expect(mergeConfig(base, overlay)).toEqual({
      a: 2,
      tui: { theme: "nord" },
      log: { ignore: ["info"] },
      providers: { deepseek: { models: ["b"] } },
    });
    expect(base.tui.theme).toBe("edex");
  });
});

describe("RuntimeConfigSchema", () => {
  test("accepts deep partial patches without defaults", () => {
    expect(RuntimeConfigSchema.parse({
      providerProfiles: { balanced: "deepseek/deepseek-v4-pro" },
      tui: { theme: "dracula" },
      providers: { deepseek: { thinking: "enabled" } },
    })).toEqual({
      providerProfiles: { balanced: "deepseek/deepseek-v4-pro" },
      tui: { theme: "dracula" },
      providers: { deepseek: { thinking: "enabled" } },
    });
  });

  test("rejects gateway and unknown keys", () => {
    expect(() => RuntimeConfigSchema.parse({ gateway: { port: 4000 } })).toThrow();
    expect(() => RuntimeConfigSchema.parse({ bogus: 1 })).toThrow();
  });

  test("converts legacy maxChainDepth into maxGlobalRounds", () => {
    expect(RuntimeConfigSchema.parse({ conversation: { maxChainDepth: 8 } }).conversation)
      .toEqual({ maxChainDepth: 8, maxGlobalRounds: 9 });
  });

  test("overlaySchema is strict and optional at every level", () => {
    const schema = overlaySchema(ConfigSchema);
    expect(schema.parse({ tui: { theme: "nord" } })).toEqual({ tui: { theme: "nord" } });
    expect(() => schema.parse({ nope: true })).toThrow();
  });
});
