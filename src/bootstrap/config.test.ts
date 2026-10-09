import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigSchema, mergeConfig, RuntimeConfigSchema, loadConfig, saveRuntimeConfig, runtimeConfigPath,
} from "./config";

const tempDirs: string[] = [];
function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-config-test-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("mergeConfig", () => {
  test("overlay wins over base for primitives", () => {
    expect(mergeConfig({ a: 1, b: "x" }, { b: "y" })).toEqual({ a: 1, b: "y" });
  });

  test("objects merge recursively", () => {
    expect(mergeConfig(
      { tui: { theme: "edex" }, transport: { maxOutputTokens: 4096 } },
      { tui: { theme: "dracula" } },
    )).toEqual({ tui: { theme: "dracula" }, transport: { maxOutputTokens: 4096 } });
  });

  test("arrays replace wholesale while record values merge deeply", () => {
    const base = { log: { ignore: ["debug"] }, providers: { deepseek: { apiKeyEnv: "X", models: ["a"] } } };
    const overlay = { log: { ignore: ["info", "warn"] }, providers: { deepseek: { models: ["b"] } } };
    expect(mergeConfig(base, overlay)).toEqual({
      log: { ignore: ["info", "warn"] },
      providers: { deepseek: { apiKeyEnv: "X", models: ["b"] } },
    });
  });

  test("does not mutate inputs", () => {
    const base = { tui: { theme: "edex" } };
    const overlay = { tui: { theme: "nord" } };
    mergeConfig(base, overlay);
    expect(base.tui.theme).toBe("edex");
  });
});

describe("RuntimeConfigSchema", () => {
  test("accepts deep partial patches", () => {
    expect(RuntimeConfigSchema.parse({
      providerProfiles: { balanced: "deepseek/deepseek-v4-pro" },
      tui: { theme: "dracula" },
      providers: { deepseek: { thinking: "enabled" } },
      transport: { maxOutputTokens: 8192 },
    })).toEqual({
      providerProfiles: { balanced: "deepseek/deepseek-v4-pro" },
      tui: { theme: "dracula" },
      providers: { deepseek: { thinking: "enabled" } },
      transport: { maxOutputTokens: 8192 },
    });
  });

  test("rejects the gateway subtree", () => {
    expect(() => RuntimeConfigSchema.parse({ gateway: { port: 4000 } })).toThrow();
  });

  test("rejects unknown keys and invalid values", () => {
    expect(() => RuntimeConfigSchema.parse({ bogus: 1 })).toThrow();
    expect(() => RuntimeConfigSchema.parse({ tui: { theme: "neon" } })).toThrow();
  });
});

describe("loadConfig layering", () => {
  test("merges user config with runtime overlay", () => {
    const sandbox = makeSandbox();
    saveRuntimeConfig(sandbox, {
      providerProfiles: { balanced: "deepseek/deepseek-v4-pro" },
      tui: { theme: "dracula" },
    });
    const { userConfig, runtimeConfig, effective } = loadConfig(sandbox);
    expect(userConfig.providerProfiles.balanced).toBe("deepseek/deepseek-v4-flash");
    expect(runtimeConfig.tui).toEqual({ theme: "dracula" });
    expect(effective.providerProfiles.balanced).toBe("deepseek/deepseek-v4-pro");
    expect(effective.providerProfiles.advanced).toBe("deepseek/deepseek-v4-flash");
    expect(effective.tui.theme).toBe("dracula");
    expect(effective.gateway.port).toBe(3000);
  });

  test("empty or missing overlay yields user config", () => {
    const sandbox = makeSandbox();
    const { runtimeConfig, effective } = loadConfig(sandbox);
    expect(runtimeConfig).toEqual({});
    expect(effective.providerProfiles.balanced).toBe("deepseek/deepseek-v4-flash");
    expect(runtimeConfigPath(sandbox).endsWith("/.atom/runtime-config.json")).toBe(true);
  });

  test("recovers from an invalid provider by dropping it and keeping the rest", () => {
    const sandbox = makeSandbox();
    Bun.write(`${sandbox}/config.json`, JSON.stringify({
      version: 2,
      providerProfiles: { advanced: "deepseek/deepseek-v4-pro", balanced: "deepseek/deepseek-v4-flash", basic: "deepseek/deepseek-v4-flash" },
      providers: {
        deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY", models: ["deepseek-v4-flash"], thinking: "enabled" },
        broken: { models: [], thinking: "disabled" },
      },
      gateway: { port: 3456, clients: [] },
      tui: { theme: "dracula" },
    }));

    const { userConfig, effective } = loadConfig(sandbox);
    expect(userConfig.providers.deepseek).toBeDefined();
    expect(userConfig.providers.broken).toBeUndefined();
    expect(userConfig.gateway.port).toBe(3456);
    expect(userConfig.tui.theme).toBe("dracula");
    expect(effective.providers.deepseek.thinking).toBe("enabled");
  });

  test("falls back to defaults only when sanitizing cannot fix the config", () => {
    const sandbox = makeSandbox();
    Bun.write(`${sandbox}/config.json`, JSON.stringify({ version: 3, providers: "nonsense" }));
    const { userConfig } = loadConfig(sandbox);
    expect(userConfig.providerProfiles.balanced).toBe("deepseek/deepseek-v4-flash");
  });
});

test("continuation arbitration defaults to jev and supports rules-only runtime rollback", () => {
  const sandbox = makeSandbox();
  expect(loadConfig(sandbox).effective.decisionMode.continuation).toBe("jev");
  saveRuntimeConfig(sandbox, { decisionMode: { continuation: "rules" } });
  expect(loadConfig(sandbox).effective.decisionMode.continuation).toBe("rules");
  expect(() => RuntimeConfigSchema.parse({ decisionMode: { continuation: "legacy" } })).toThrow();
});


test("two budgets default independently and migrate explicit legacy depth", () => {
  expect(ConfigSchema.parse({}).conversation).toMatchObject({ maxGlobalRounds: 100, maxLocalRounds: 5 });
  expect(ConfigSchema.parse({ conversation: { maxChainDepth: 5 } }).conversation.maxGlobalRounds).toBe(6);
  expect(ConfigSchema.parse({ conversation: { maxChainDepth: 5, maxGlobalRounds: 200 } }).conversation.maxGlobalRounds).toBe(200);
  for (const value of [0, -1, 1.5]) expect(() => ConfigSchema.parse({ conversation: { maxGlobalRounds: value } })).toThrow();
  for (const value of [4, 11, 5.5]) expect(() => RuntimeConfigSchema.parse({ conversation: { maxLocalRounds: value } })).toThrow();
  expect(RuntimeConfigSchema.parse({ conversation: { maxGlobalRounds: 200, maxLocalRounds: 10 } })).toEqual({ conversation: { maxGlobalRounds: 200, maxLocalRounds: 10 } });
});


test("legacy runtime budget patch is converted before merging parsed defaults", () => {
  const patch = RuntimeConfigSchema.parse({ conversation: { maxChainDepth: 8 } });
  expect(patch.conversation).toEqual({ maxChainDepth: 8, maxGlobalRounds: 9 });
  expect(ConfigSchema.parse(mergeConfig(ConfigSchema.parse({}), patch)).conversation.maxGlobalRounds).toBe(9);
  expect(RuntimeConfigSchema.parse({ conversation: { maxChainDepth: 8, maxGlobalRounds: 200 } }).conversation!.maxGlobalRounds).toBe(200);
});
