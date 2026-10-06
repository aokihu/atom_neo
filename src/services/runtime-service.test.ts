import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeService } from "./runtime-service";

const tempDirs: string[] = [];
function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-runtime-test-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRuntime(sandbox: string): RuntimeService {
  return new RuntimeService({
    mode: "core",
    port: 3100,
    host: "127.0.0.1",
    sandbox,
    apiKey: "sk-test",
  });
}

describe("RuntimeService runtime config", () => {
  test("resolves fast Jev provider separately from LLM credentials", () => {
    const runtime = makeRuntime(makeSandbox());
    runtime.updateRuntimeConfig({
      providerProfiles: { fast: "openrouter-jev/typesafe/jev-1.13" },
      providers: { "openrouter-jev": { type: "jev", apiKeyEnv: "ATOM_TEST_MISSING_JEV_KEY", models: ["typesafe/jev-1.13"], baseUrl: "https://openrouter.ai/api/alpha/decisions" } },
      decisionMode: { prediction: "jev", postConversation: "jev" },
    });
    expect(runtime.getResolvedModel("fast")).toMatchObject({ provider: "openrouter-jev", model: "typesafe/jev-1.13", type: "jev", apiKey: "" });
    expect(runtime.getResolvedModel("basic")).toMatchObject({ type: "llm", apiKey: "sk-test" });
    expect(runtime.appConfig.decisionMode).toEqual({ prediction: "jev", postConversation: "jev" });
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
