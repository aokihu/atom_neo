import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initialState, beginEdit, beginNewProvider, updatePendingApiKey, finalizeEdit, cloneEdit,
  commit, readEnvKeys, writeEnvKeys, buildInitialState, collectModelIds,
  addModel, removeModelAt, parseContextLimit, parsePort,
} from "./wizard-logic";
import type { WizardState } from "./wizard-logic";

const tempDirs: string[] = [];
function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-wizard-test-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function configState(overrides: Partial<WizardState> = {}): WizardState {
  return { ...initialState("config"), ...overrides };
}

function firstRunState(overrides: Partial<WizardState> = {}): WizardState {
  return { ...initialState("first-run"), ...overrides };
}

const deepseekEdit = {
  apiKeyEnv: "DEEPSEEK_API_KEY",
  apiKey: "sk-existing",
  models: ["deepseek-v4-flash"],
  thinking: "enabled" as const,
};

// ─── beginEdit / beginNewProvider ─────────────────────────────────────────

describe("beginEdit / beginNewProvider", () => {
  test("editing an existing provider takes a snapshot and leaves editedProviders untouched", () => {
    const state = configState({ editedProviders: { deepseek: deepseekEdit } });
    const { state: next, pending } = beginEdit(state, "deepseek");

    expect(pending?.isNew).toBe(false);
    expect(pending?.edit).toEqual(deepseekEdit);
    expect(next.editedProviders.deepseek).toEqual(deepseekEdit);
    expect(next.step).toBe(1);
  });

  test("adding a new provider does not enter editedProviders yet", () => {
    const state = configState();
    const { state: next, pending } = beginNewProvider(state, "volengine");

    expect(next.editedProviders).toEqual({});
    expect(pending).toEqual({
      id: "volengine",
      isNew: true,
      edit: { apiKeyEnv: "", apiKey: "", models: [], thinking: "disabled" },
    });
  });

  test("first-run known providers reset the profiles and prefill env keys", () => {
    const state = firstRunState({ envKeys: { DEEPSEEK_API_KEY: "sk-x" } });
    const { state: next, pending } = beginEdit(state, "deepseek");

    expect(pending?.edit.apiKey).toBe("sk-x");
    expect(next.profiles.advanced).toBe("deepseek/deepseek-v4-flash");
    expect(next.editedProviders).toEqual({});
  });
});

// ─── Atomic rollback ──────────────────────────────────────────────────────

describe("atomic rollback", () => {
  test("cancelling mid-edit leaves editedProviders unchanged", () => {
    const state = configState({ editedProviders: { deepseek: deepseekEdit } });
    const { state: s1, pending } = beginEdit(state, "deepseek");
    const { state: s2, pending: p2 } = updatePendingApiKey(s1, pending!, "sk-changed");

    expect(p2.edit.apiKey).toBe("sk-changed");
    expect(s2.editedProviders.deepseek).toEqual(deepseekEdit);
    expect(s2.envKeys).toEqual({});
  });

  test("cancelling a new provider edit never adds it", () => {
    const state = configState();
    const { state: s1, pending } = beginNewProvider(state, "volengine");
    const { state: s2 } = updatePendingApiKey(s1, pending, "sk-vol", undefined, "VOLENGINE_API_KEY");
    expect(s2.editedProviders).toEqual({});
    expect(s2.envKeys).toEqual({});
  });
});

// ─── finalizeEdit ─────────────────────────────────────────────────────────

describe("finalizeEdit", () => {
  test("finalizing lands the edit in editedProviders and updates envKeys", () => {
    const state = configState();
    const { state: s1, pending } = beginNewProvider(state, "volengine");
    const { state: s2, pending: p2 } = updatePendingApiKey(s1, pending, "sk-vol", undefined, "VOLENGINE_API_KEY");

    const final = finalizeEdit(s2, p2, { models: ["model-a"], baseUrl: undefined, thinking: "adaptive" });

    expect(final).not.toBeNull();
    expect(final!.editedProviders.volengine).toEqual({
      apiKeyEnv: "VOLENGINE_API_KEY",
      apiKey: "sk-vol",
      models: ["model-a"],
      thinking: "adaptive",
    });
    expect(final!.envKeys).toEqual({ VOLENGINE_API_KEY: "sk-vol" });
    expect(final!.step).toBe(1); // config: back to the providers list
  });

  test("first-run finalize advances to the next step", () => {
    const state = firstRunState();
    const { state: s1, pending } = beginEdit(state, "deepseek");
    const { state: s2, pending: p2 } = updatePendingApiKey(s1, pending!, "sk-x");
    expect(s2.step).toBe(2); // models step

    const final = finalizeEdit(s2, p2, { models: ["deepseek-v4-flash"], thinking: "disabled" });

    expect(final!.step).toBe(3);
    expect(final!.editedProviders.deepseek.apiKey).toBe("sk-x");
    expect(final!.envKeys).toEqual({ DEEPSEEK_API_KEY: "sk-x" });
  });

  test("rejects finalize with no models (invalid edit stays pending, not committed)", () => {
    const state = configState();
    const { state: s1, pending } = beginNewProvider(state, "volengine");
    const { state: s2, pending: p2 } = updatePendingApiKey(s1, pending, "sk-vol", undefined, "VOLENGINE_API_KEY");

    const final = finalizeEdit(s2, p2, { models: [], thinking: "disabled" });

    expect(final).toBeNull();
    expect(s2.editedProviders).toEqual({});
  });

  test("cancelling after a failed finalize still rolls back cleanly", () => {
    const state = configState({ editedProviders: { deepseek: deepseekEdit } });
    const { state: s1, pending } = beginEdit(state, "deepseek");
    const { state: s2, pending: p2 } = updatePendingApiKey(s1, pending!, "sk-changed");
    const rejected = finalizeEdit(s2, p2, { models: [], thinking: "enabled" });

    expect(rejected).toBeNull();
    expect(s2.editedProviders.deepseek).toEqual(deepseekEdit);
  });
});

describe("cloneEdit", () => {
  test("deep-copies the models array", () => {
    const edit = { ...deepseekEdit, models: ["a"] };
    const copy = cloneEdit(edit);
    copy.models.push("b");
    expect(edit.models).toEqual(["a"]);
  });
});

describe("collectModelIds", () => {
  test("flattens provider models into provider/model ids", () => {
    expect(collectModelIds({
      deepseek: { ...deepseekEdit, models: ["v4-pro", "v4-flash"] },
      openai: { apiKeyEnv: "OPENAI_API_KEY", apiKey: "", models: ["gpt-4o"], thinking: "disabled" },
    })).toEqual(["deepseek/v4-flash", "deepseek/v4-pro", "openai/gpt-4o"]);
  });

  test("returns an empty list when no providers are finalized", () => {
    expect(collectModelIds({})).toEqual([]);
  });
});

// ─── env utils ────────────────────────────────────────────────────────────

describe("readEnvKeys / writeEnvKeys", () => {
  test("parses KEY=VALUE lines, skipping comments and blanks", () => {
    const sandbox = makeSandbox();
    const envPath = `${sandbox}/.env`;
    Bun.write(envPath, "# comment\n\nDEEPSEEK_API_KEY=sk-a\nOTHER=keep-me\n");
    expect(readEnvKeys(envPath)).toEqual({ DEEPSEEK_API_KEY: "sk-a", OTHER: "keep-me" });
  });

  test("returns empty for a missing .env", () => {
    expect(readEnvKeys(`${makeSandbox()}/.env`)).toEqual({});
  });

  test("upserts keys while preserving other lines and comments", () => {
    const sandbox = makeSandbox();
    const envPath = `${sandbox}/.env`;
    Bun.write(envPath, "# keep comment\nDEEPSEEK_API_KEY=old\nOPENAI_API_KEY=sk-openai\n");

    writeEnvKeys(envPath, { DEEPSEEK_API_KEY: "new-key", NEWPROVIDER_API_KEY: "sk-new" });

    const content = readFileSync(envPath, "utf-8");
    expect(content).toContain("# keep comment");
    expect(content).toContain("DEEPSEEK_API_KEY=new-key");
    expect(content).toContain("OPENAI_API_KEY=sk-openai");
    expect(content).toContain("NEWPROVIDER_API_KEY=sk-new");
    expect(content).not.toContain("DEEPSEEK_API_KEY=old");
  });
});

// ─── commit (config mode) ─────────────────────────────────────────────────

describe("commit (config mode)", () => {
  test("merges edited providers into existing config and preserves unknown fields", () => {
    const sandbox = makeSandbox();
    Bun.write(`${sandbox}/config.json`, JSON.stringify({
      version: 2,
      customField: { keep: true },
      providers: {
        deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY", models: ["deepseek-v4-flash"], thinking: "disabled" },
        openai: { apiKeyEnv: "OPENAI_API_KEY", models: ["gpt-4o"], thinking: "enabled" },
      },
      gateway: { port: 3000 },
    }));

    const state = configState({
      profiles: {
        advanced: "deepseek/deepseek-v4-pro",
        balanced: "deepseek/deepseek-v4-flash",
        basic: "openai/gpt-4o",
      },
      theme: "dracula",
      editedProviders: {
        deepseek: {
          apiKeyEnv: "DEEPSEEK_API_KEY",
          apiKey: "sk-new",
          models: ["deepseek-v4-flash", "deepseek-v4-pro"],
          thinking: "enabled",
          contextLimit: 131072,
        },
      },
      envKeys: { DEEPSEEK_API_KEY: "sk-new" },
    });

    commit(sandbox, state);

    const config = JSON.parse(readFileSync(`${sandbox}/config.json`, "utf-8"));
    expect(config.customField).toEqual({ keep: true });
    expect(config.gateway).toEqual({ port: 3000 });
    expect(config.providers.deepseek).toEqual({
      apiKeyEnv: "DEEPSEEK_API_KEY",
      models: ["deepseek-v4-flash", "deepseek-v4-pro"],
      thinking: "enabled",
      contextLimit: 131072,
    });
    expect(config.providers.openai).toEqual({
      apiKeyEnv: "OPENAI_API_KEY",
      models: ["gpt-4o"],
      thinking: "enabled",
    });
    expect(config.providerProfiles.basic).toBe("openai/gpt-4o");
    expect(config.tui).toEqual({ theme: "dracula" });
  });

  test("adds new providers and writes API keys to .env only", () => {
    const sandbox = makeSandbox();
    Bun.write(`${sandbox}/.env`, "EXISTING=keep\n");

    const state = configState({
      editedProviders: {
        myapi: {
          apiKeyEnv: "MYAPI_API_KEY",
          apiKey: "sk-myapi",
          models: ["model-a", "model-b"],
          baseUrl: "https://myapi.example.com/v1",
          thinking: "adaptive",
        },
      },
      envKeys: { MYAPI_API_KEY: "sk-myapi" },
    });

    commit(sandbox, state);

    const config = JSON.parse(readFileSync(`${sandbox}/config.json`, "utf-8"));
    expect(config.providers.myapi).toEqual({
      apiKeyEnv: "MYAPI_API_KEY",
      models: ["model-a", "model-b"],
      baseUrl: "https://myapi.example.com/v1",
      thinking: "adaptive",
    });
    expect(JSON.stringify(config)).not.toContain("sk-myapi");

    const env = readFileSync(`${sandbox}/.env`, "utf-8");
    expect(env).toContain("EXISTING=keep");
    expect(env).toContain("MYAPI_API_KEY=sk-myapi");
  });

  test("does not write AGENTS.md or .atom/installed in config mode", () => {
    const sandbox = makeSandbox();
    const state = configState({ editedProviders: {} });
    commit(sandbox, state);
    expect(existsSync(`${sandbox}/AGENTS.md`)).toBe(false);
    expect(existsSync(`${sandbox}/.atom/installed`)).toBe(false);
  });

  test("removes models deleted from the edited list", () => {
    const sandbox = makeSandbox();
    Bun.write(`${sandbox}/config.json`, JSON.stringify({
      providers: { deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY", models: ["m1", "m2", "m3"], thinking: "disabled" } },
    }));

    const state = configState({
      editedProviders: {
        deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY", apiKey: "", models: ["m1", "m3"], thinking: "disabled" },
      },
    });

    commit(sandbox, state);
    const config = JSON.parse(readFileSync(`${sandbox}/config.json`, "utf-8"));
    expect(config.providers.deepseek.models).toEqual(["m1", "m3"]);
  });

  test("skips invalid provider edits (no models) so cancelled edits never corrupt the config", () => {
    const sandbox = makeSandbox();
    Bun.write(`${sandbox}/config.json`, JSON.stringify({
      providers: { deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY", models: ["m1"], thinking: "disabled" } },
    }));

    const state = configState({
      editedProviders: {
        deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY", apiKey: "", models: ["m1"], thinking: "disabled" },
        volengine: { apiKeyEnv: "VOLENGINE_API_KEY", apiKey: "sk-vol", models: [], thinking: "disabled" },
      },
    });

    commit(sandbox, state);
    const config = JSON.parse(readFileSync(`${sandbox}/config.json`, "utf-8"));
    expect(config.providers.volengine).toBeUndefined();
    expect(config.providers.deepseek).toBeDefined();
  });

  test("writes apiKeyEnv as empty string instead of dropping the field", () => {
    const sandbox = makeSandbox();
    const state = configState({
      editedProviders: {
        custom: { apiKeyEnv: "", apiKey: "", models: ["m"], thinking: "disabled" },
      },
    });

    commit(sandbox, state);
    const config = JSON.parse(readFileSync(`${sandbox}/config.json`, "utf-8"));
    expect(config.providers.custom.apiKeyEnv).toBe("");
    expect(config.providers.custom.models).toEqual(["m"]);
  });

  test("config mode updates the gateway port and preserves clients", () => {
    const sandbox = makeSandbox();
    Bun.write(`${sandbox}/config.json`, JSON.stringify({
      gateway: { port: 3000, clients: [{ id: "telegram-bot" }] },
    }));

    const state = configState({ gatewayPort: 4123, editedProviders: {} });
    commit(sandbox, state);

    const config = JSON.parse(readFileSync(`${sandbox}/config.json`, "utf-8"));
    expect(config.gateway).toEqual({ port: 4123, clients: [{ id: "telegram-bot" }] });
  });

  test("config mode writes a default gateway when none existed", () => {
    const sandbox = makeSandbox();
    const state = configState({ gatewayPort: 8080, editedProviders: {} });
    commit(sandbox, state);
    const config = JSON.parse(readFileSync(`${sandbox}/config.json`, "utf-8"));
    expect(config.gateway).toEqual({ port: 8080 });
  });

  test("first-run mode does not touch the gateway section", () => {
    const sandbox = makeSandbox();
    Bun.write(`${sandbox}/config.json`, JSON.stringify({ gateway: { port: 4321 } }));
    const state = firstRunState({ projectDescription: "", editedProviders: {} });
    commit(sandbox, state);
    const config = JSON.parse(readFileSync(`${sandbox}/config.json`, "utf-8"));
    expect(config.gateway).toEqual({ port: 4321 });
  });
});

// ─── commit (first-run mode) ──────────────────────────────────────────────

describe("commit (first-run mode)", () => {
  test("writes AGENTS.md and .atom/installed marker", () => {
    const sandbox = makeSandbox();
    const state = firstRunState({
      projectDescription: "test project",
      editedProviders: {
        deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY", apiKey: "sk-x", models: ["deepseek-v4-flash"], thinking: "disabled" },
      },
      envKeys: { DEEPSEEK_API_KEY: "sk-x" },
    });

    commit(sandbox, state);

    expect(existsSync(`${sandbox}/AGENTS.md`)).toBe(true);
    expect(readFileSync(`${sandbox}/AGENTS.md`, "utf-8")).toContain("test project");
    expect(existsSync(`${sandbox}/.atom/installed`)).toBe(true);
    const config = JSON.parse(readFileSync(`${sandbox}/config.json`, "utf-8"));
    expect(config.providers.deepseek.thinking).toBe("disabled");
  });

  test("does not write AGENTS.md without a project description", () => {
    const sandbox = makeSandbox();
    const state = firstRunState({ projectDescription: "", editedProviders: {} });
    commit(sandbox, state);
    expect(existsSync(`${sandbox}/AGENTS.md`)).toBe(false);
    expect(existsSync(`${sandbox}/.atom/installed`)).toBe(true);
  });
});

// ─── buildInitialState ────────────────────────────────────────────────────

describe("buildInitialState", () => {
  test("first-run mode starts from defaults without touching the sandbox", () => {
    const state = buildInitialState("first-run", makeSandbox());
    expect(state.step).toBe(0);
    expect(state.provider).toBe("deepseek");
    expect(state.editedProviders).toEqual({});
    expect(state.envKeys).toEqual({});
  });

  test("config mode pre-fills from config.json and .env", () => {
    const sandbox = makeSandbox();
    Bun.write(`${sandbox}/config.json`, JSON.stringify({
      version: 2,
      providerProfiles: {
        advanced: "deepseek/deepseek-v4-pro",
        balanced: "deepseek/deepseek-v4-flash",
        basic: "openai/gpt-4o-mini",
      },
      providers: {
        deepseek: {
          apiKeyEnv: "DEEPSEEK_API_KEY",
          models: ["deepseek-v4-flash", "deepseek-v4-pro"],
          thinking: "enabled",
          contextLimit: 131072,
        },
        openai: { apiKeyEnv: "OPENAI_API_KEY", models: ["gpt-4o"] },
      },
      tui: { theme: "dracula" },
    }));
    Bun.write(`${sandbox}/.env`, "DEEPSEEK_API_KEY=sk-deepseek\nOPENAI_API_KEY=sk-openai\n");

    const state = buildInitialState("config", sandbox);

    expect(state.mode).toBe("config");
    expect(Object.keys(state.editedProviders).sort()).toEqual(["deepseek", "openai"]);
    expect(state.editedProviders.deepseek).toEqual({
      apiKeyEnv: "DEEPSEEK_API_KEY",
      apiKey: "sk-deepseek",
      models: ["deepseek-v4-flash", "deepseek-v4-pro"],
      thinking: "enabled",
      contextLimit: 131072,
    });
    expect(state.editedProviders.openai.thinking).toBe("disabled");
    expect(state.envKeys).toEqual({ DEEPSEEK_API_KEY: "sk-deepseek", OPENAI_API_KEY: "sk-openai" });
    expect(state.profiles.advanced).toBe("deepseek/deepseek-v4-pro");
    expect(state.theme).toBe("dracula");
    expect(state.provider).toBe("deepseek");
  });

  test("config mode pre-fills the gateway port", () => {
    const sandbox = makeSandbox();
    Bun.write(`${sandbox}/config.json`, JSON.stringify({ gateway: { port: 4123 } }));
    expect(buildInitialState("config", sandbox).gatewayPort).toBe(4123);
    expect(buildInitialState("config", makeSandbox()).gatewayPort).toBe(3000);
  });

  test("config mode tolerates missing config and .env", () => {
    const state = buildInitialState("config", makeSandbox());
    expect(state.editedProviders).toEqual({});
    expect(state.profiles.balanced).toBe("deepseek/deepseek-v4-flash");
    expect(state.theme).toBe("edex");
  });

  test("config mode falls back on invalid theme values", () => {
    const sandbox = makeSandbox();
    Bun.write(`${sandbox}/config.json`, JSON.stringify({ tui: { theme: "neon" } }));
    const state = buildInitialState("config", sandbox);
    expect(state.theme).toBe("edex");
  });
});

test("config wizard preserves manually configured Jev profile, type, and decision mode", () => {
  const sandbox = makeSandbox();
  Bun.write(`${sandbox}/config.json`, JSON.stringify({
    providerProfiles: { advanced: "deepseek/a", balanced: "deepseek/a", basic: "deepseek/a", fast: "decisions/typesafe/jev-1.13" },
    providers: { decisions: { type: "jev", apiKeyEnv: "OPENROUTER_API_KEY", models: ["typesafe/jev-1.13"], baseUrl: "https://openrouter.ai/api/alpha/decisions" } },
    decisionMode: { prediction: "jev", postConversation: "jev" },
  }));
  commit(sandbox, buildInitialState("config", sandbox));
  const saved = JSON.parse(readFileSync(`${sandbox}/config.json`, "utf-8"));
  expect(saved.providerProfiles.fast).toBe("decisions/typesafe/jev-1.13");
  expect(saved.providers.decisions.type).toBe("jev");
  expect(saved.decisionMode).toEqual({ prediction: "jev", postConversation: "jev" });
});

// ─── parsers ──────────────────────────────────────────────────────────────

describe("addModel", () => {
  test("appends a trimmed new model", () => {
    expect(addModel(["a"], " b ")).toEqual(["a", "b"]);
  });

  test("ignores blanks and duplicates", () => {
    expect(addModel(["a"], "  ")).toEqual(["a"]);
    expect(addModel(["a"], "a")).toEqual(["a"]);
  });
});

describe("removeModelAt", () => {
  test("removes the model at the given index", () => {
    expect(removeModelAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });

  test("ignores out-of-range indexes", () => {
    expect(removeModelAt(["a"], -1)).toEqual(["a"]);
    expect(removeModelAt(["a"], 5)).toEqual(["a"]);
  });
});

describe("parseContextLimit", () => {
  test("parses positive integers", () => {
    expect(parseContextLimit("131072")).toBe(131072);
  });

  test("returns undefined for empty input", () => {
    expect(parseContextLimit("")).toBeUndefined();
    expect(parseContextLimit("   ")).toBeUndefined();
  });

  test("rejects non-positive or non-integer values", () => {
    expect(parseContextLimit("0")).toBeUndefined();
    expect(parseContextLimit("-5")).toBeUndefined();
    expect(parseContextLimit("1.5")).toBeUndefined();
    expect(parseContextLimit("abc")).toBeUndefined();
  });
});

describe("parsePort", () => {
  test("parses valid port numbers", () => {
    expect(parsePort("3000")).toBe(3000);
    expect(parsePort("65535")).toBe(65535);
    expect(parsePort(" 1 ")).toBe(1);
  });

  test("rejects out-of-range and non-integer values", () => {
    expect(parsePort("0")).toBeUndefined();
    expect(parsePort("65536")).toBeUndefined();
    expect(parsePort("-1")).toBeUndefined();
    expect(parsePort("1.5")).toBeUndefined();
    expect(parsePort("abc")).toBeUndefined();
    expect(parsePort("")).toBeUndefined();
  });
});
