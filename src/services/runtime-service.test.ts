import { describe, expect, test, afterAll, beforeAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeService } from "./runtime-service";
import { ConfigSchema, loadConfig } from "../bootstrap/config";

const TEST_KEY_ENV = "ATOM_TEST_DEEPSEEK_KEY";
const OPENAI_KEY_ENV = "ATOM_TEST_OPENAI_KEY";

const tempDirs: string[] = [];
function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-runtime-test-"));
  tempDirs.push(dir);
  return dir;
}
beforeAll(() => {
  process.env[TEST_KEY_ENV] = "sk-test";
  process.env[OPENAI_KEY_ENV] = "sk-openai";
});
afterAll(() => {
  delete process.env[TEST_KEY_ENV];
  delete process.env[OPENAI_KEY_ENV];
});
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRuntime(sandbox: string): RuntimeService {
  const userConfig = ConfigSchema.parse({
    providers: {
      deepseek: { apiKeyEnv: TEST_KEY_ENV, models: ["deepseek-v4-flash", "deepseek-v4-pro"] },
    },
  });
  return new RuntimeService({
    mode: "core",
    port: 3100,
    host: "127.0.0.1",
    sandbox,
    config: { userConfig, runtimeConfig: {}, effective: userConfig },
  });
}

describe("RuntimeService runtime config", () => {
  test("thinking overlay takes effect immediately and survives reload", async () => {
    const sandbox = makeSandbox();
    const userConfig = ConfigSchema.parse({ providers: {
      deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY", models: ["deepseek-flash"], thinking: "disabled" },
    } });
    await Bun.write(join(sandbox, "config.json"), JSON.stringify(userConfig));
    const runtime = new RuntimeService({ mode: "core", port: 3100, host: "127.0.0.1", sandbox,
      config: loadConfig(sandbox) });

    runtime.updateRuntimeConfig({ providers: { deepseek: { thinking: "enabled" } } });
    expect(runtime.getResolvedModel("balanced").thinking).toBe("enabled");
    expect(JSON.parse(readFileSync(runtime.runtimeConfigPath, "utf-8"))).toEqual({ providers: { deepseek: { thinking: "enabled" } } });
    expect(loadConfig(sandbox).effective.providers.deepseek.thinking).toBe("enabled");

    runtime.updateRuntimeConfig({ providers: { deepseek: { thinking: "disabled" } } });
    expect(runtime.getResolvedModel("balanced").thinking).toBe("disabled");
  });

  test("resolves fast Jev provider separately from LLM credentials", () => {
    const runtime = makeRuntime(makeSandbox());
    runtime.updateRuntimeConfig({
      providerProfiles: { fast: "openrouter-jev/typesafe/jev-1.13" },
      providers: { "openrouter-jev": { type: "jev", apiKeyEnv: "ATOM_TEST_MISSING_JEV_KEY", models: ["typesafe/jev-1.13"], baseUrl: "https://openrouter.ai/api/alpha/decisions" } },
      decisionMode: { prediction: "jev", postConversation: "jev" },
    });
    expect(runtime.getResolvedModel("fast")).toMatchObject({ provider: "openrouter-jev", model: "typesafe/jev-1.13", type: "jev", apiKey: "" });
    expect(runtime.getResolvedModel("basic")).toMatchObject({ type: "llm", apiKey: "sk-test" });
    expect(runtime.appConfig.decisionMode).toEqual({ prediction: "jev", postConversation: "jev", continuation: "jev" });
  });

  test("resolves protocol/options and never borrows another provider's key", () => {
    const runtime = makeRuntime(makeSandbox());
    runtime.updateRuntimeConfig({
      providerProfiles: {
        balanced: "openai/gpt-4o",
        fast: "anthropic/claude-sonnet",
        basic: "custom/model-a",
      },
      providers: {
        openai: {
          apiKeyEnv: OPENAI_KEY_ENV,
          models: ["gpt-4o"],
          options: { openai: { reasoningEffort: "low" } },
        },
        anthropic: {
          apiKeyEnv: "ATOM_TEST_MISSING_ANTHROPIC_KEY",
          models: ["claude-sonnet"],
        },
        custom: {
          protocol: "openai-compatible",
          apiKeyEnv: "ATOM_TEST_MISSING_CUSTOM_KEY",
          models: ["model-a"],
          baseUrl: "https://example.test/v1",
        },
      },
    });

    expect(runtime.getResolvedModel("balanced")).toMatchObject({
      provider: "openai",
      protocol: "openai",
      model: "gpt-4o",
      type: "llm",
      apiKey: "sk-openai",
      options: { openai: { reasoningEffort: "low" } },
    });
    // Missing env vars resolve to empty, not sk-test/sk-openai.
    expect(runtime.getResolvedModel("fast")).toMatchObject({
      provider: "anthropic", protocol: "anthropic", apiKey: "",
    });
    expect(runtime.getResolvedModel("basic")).toMatchObject({
      provider: "custom", protocol: "openai-compatible", apiKey: "", baseUrl: "https://example.test/v1",
    });
  });

  test("updateRuntimeConfig merges into effective config and persists overlay", () => {
    const sandbox = makeSandbox();
    const runtime = makeRuntime(sandbox);

    const effective = runtime.updateRuntimeConfig({
      providerProfiles: { balanced: "deepseek/deepseek-v4-pro" },
    });

    expect(effective.providerProfiles.balanced).toBe("deepseek/deepseek-v4-pro");
    expect(effective.providerProfiles.basic).toBe("deepseek/deepseek-v4-flash");
    expect(runtime.appConfig.providerProfiles.balanced).toBe("deepseek/deepseek-v4-pro");
    expect(runtime.getResolvedModel("balanced").model).toBe("deepseek-v4-pro");

    const onDisk = JSON.parse(readFileSync(runtime.runtimeConfigPath, "utf-8"));
    expect(onDisk).toEqual({ providerProfiles: { balanced: "deepseek/deepseek-v4-pro" } });
  });

  test("later patches accumulate without clobbering earlier ones", () => {
    const sandbox = makeSandbox();
    const runtime = makeRuntime(sandbox);
    runtime.updateRuntimeConfig({ tui: { theme: "dracula" } });
    runtime.updateRuntimeConfig({ transport: { maxOutputTokens: 8192 } });

    expect(runtime.appConfig.tui.theme).toBe("dracula");
    expect(runtime.appConfig.transport.maxOutputTokens).toBe(8192);
    expect(runtime.runtimeConfig).toEqual({
      tui: { theme: "dracula" },
      transport: { maxOutputTokens: 8192 },
    });
  });

  test("rejects gateway patches and keeps overlay unchanged", () => {
    const sandbox = makeSandbox();
    const runtime = makeRuntime(sandbox);
    runtime.updateRuntimeConfig({ tui: { theme: "dracula" } });

    expect(() => runtime.updateRuntimeConfig({ gateway: { port: 4000 } })).toThrow();
    expect(runtime.appConfig.gateway.port).toBe(3000);
    expect(runtime.appConfig.tui.theme).toBe("dracula");
  });

  test("resetRuntimeConfig removes the overlay file and restores user config", () => {
    const sandbox = makeSandbox();
    const runtime = makeRuntime(sandbox);
    runtime.updateRuntimeConfig({ providerProfiles: { balanced: "deepseek/deepseek-v4-pro" } });

    const effective = runtime.resetRuntimeConfig();

    expect(effective.providerProfiles.balanced).toBe("deepseek/deepseek-v4-flash");
    expect(runtime.runtimeConfig).toEqual({});
    expect(existsSync(runtime.runtimeConfigPath)).toBe(false);
  });
});
