import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "../utils/env-file";
import { writeFileAtomic } from "../utils/fs";
import type { ClientConfig } from "./client";
import {
  credentialRef,
  listInstances,
  readConfigRevision,
  removeInstance,
  upsertInstance,
} from "./client-instance";
import type { InstanceFileWriter } from "./client-instance";
import { ConfigSchema } from "./schema";

const sandboxes: string[] = [];

function sandbox(): string {
  const path = mkdtempSync(join(tmpdir(), "atom-client-instance-"));
  sandboxes.push(path);
  return path;
}

function configOf(root: string): any {
  return JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
}

function envOf(root: string): Record<string, string> {
  return parseEnv(readFileSync(join(root, ".env"), "utf8"));
}

afterEach(() => {
  for (const path of sandboxes.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("credentialRef", () => {
  test("normalizes ids and fields", () => {
    expect(credentialRef("telegram-main", "bot-token")).toBe("ATOM_CLIENT_TELEGRAM_MAIN_BOT_TOKEN");
    expect(credentialRef("  My...ID  ", " field name! ")).toBe("ATOM_CLIENT_MY_ID_FIELD_NAME");
  });

  test("rejects empty normalized parts", () => {
    expect(() => credentialRef("---", "token")).toThrow(/instance id/i);
    expect(() => credentialRef("bot", "!!!")).toThrow(/field/i);
  });
});

describe("upsertInstance", () => {
  test("creates a package instance and writes its normalized secret to .env", () => {
    const root = sandbox();
    const result = upsertInstance(root, {
      id: "telegram-main",
      package: { id: "telegram-bot", version: "0.1.0" },
      stdio: "inherit",
    }, { "bot-token": "123:secret" });

    expect(result).toEqual({
      saved: true,
      applied: false,
      configPath: join(root, "config.json"),
      envPath: join(root, ".env"),
    });
    expect(configOf(root).gateway.clients).toEqual([{
      id: "telegram-main",
      package: { id: "telegram-bot", version: "0.1.0" },
      credentials: { "bot-token": "ATOM_CLIENT_TELEGRAM_MAIN_BOT_TOKEN" },
      stdio: "inherit",
    }]);
    expect(envOf(root).ATOM_CLIENT_TELEGRAM_MAIN_BOT_TOKEN).toBe("123:secret");
  });

  test("creates a directory instance and preserves unrelated fields and clients", () => {
    const root = sandbox();
    writeFileSync(join(root, "config.json"), JSON.stringify({
      version: 2,
      customTop: { keep: true },
      gateway: {
        port: 4321,
        customGateway: "keep",
        clients: [{ id: "existing", directory: "./existing", stdio: "ignore" }],
      },
      tui: { theme: "nord" },
    }, null, 2));

    upsertInstance(root, { id: "dev", directory: "./clients/dev", stdio: "inherit" });

    const config = configOf(root);
    expect(config.customTop).toEqual({ keep: true });
    expect(config.gateway.port).toBe(4321);
    expect(config.gateway.customGateway).toBe("keep");
    expect(config.gateway.clients.map((client: ClientConfig) => client.id)).toEqual(["existing", "dev"]);
    expect(() => ConfigSchema.parse(config)).not.toThrow();
  });

  test("replaces an existing instance in place without duplicating or reordering", () => {
    const root = sandbox();
    upsertInstance(root, { id: "first", directory: "./first", stdio: "inherit" });
    upsertInstance(root, { id: "second", directory: "./second", stdio: "inherit" });
    upsertInstance(root, {
      id: "first",
      package: { id: "first-pkg", version: "2.0.0" },
      clientArgs: { mode: "longpoll" },
      stdio: "ignore",
    });

    const clients = configOf(root).gateway.clients;
    expect(clients).toHaveLength(2);
    expect(clients.map((client: ClientConfig) => client.id)).toEqual(["first", "second"]);
    expect(clients[0]).toEqual({
      id: "first",
      package: { id: "first-pkg", version: "2.0.0" },
      clientArgs: { mode: "longpoll" },
      stdio: "ignore",
    });
  });

  test("preserves caller-provided credential refs and lets secrets override them", () => {
    const root = sandbox();
    upsertInstance(root, {
      id: "bot",
      directory: "./bot",
      credentials: { token: "ATOM_CLIENT_CUSTOM_TOKEN" },
      stdio: "inherit",
    });

    expect(configOf(root).gateway.clients[0].credentials).toEqual({ token: "ATOM_CLIENT_CUSTOM_TOKEN" });
    expect(existsSync(join(root, ".env"))).toBe(false);

    upsertInstance(root, {
      id: "bot",
      directory: "./bot",
      credentials: { token: "ATOM_CLIENT_CUSTOM_TOKEN" },
      stdio: "inherit",
    }, { token: "secret-value" });

    expect(configOf(root).gateway.clients[0].credentials).toEqual({ token: "ATOM_CLIENT_BOT_TOKEN" });
    expect(envOf(root).ATOM_CLIENT_BOT_TOKEN).toBe("secret-value");
  });

  test("rejects credential ref collisions across instances", () => {
    const root = sandbox();
    upsertInstance(root, { id: "a-b", directory: "./a", stdio: "inherit" }, { token: "first" });

    expect(() => upsertInstance(
      root,
      { id: "a_b", directory: "./b", stdio: "inherit" },
      { token: "second" },
    )).toThrow(/shared by/);

    expect(configOf(root).gateway.clients.map((client: ClientConfig) => client.id)).toEqual(["a-b"]);
    expect(envOf(root).ATOM_CLIENT_A_B_TOKEN).toBe("first");
  });

  test("rejects invalid credential refs before writing anything", () => {
    const root = sandbox();
    for (const ref of ["ATOM_ADMIN_TOKEN", "ATOM_CLIENT_", "ATOM_CLIENT_bad-name"]) {
      expect(() => upsertInstance(root, {
        id: "bot",
        directory: "./bot",
        credentials: { token: ref },
        stdio: "inherit",
      })).toThrow(/credential reference/i);
    }
    expect(existsSync(join(root, "config.json"))).toBe(false);
    expect(existsSync(join(root, ".atom"))).toBe(false);
  });

  test("invalid instances are rejected before any file is created", () => {
    const root = sandbox();
    const invalid = { id: "invalid", stdio: "inherit" } as unknown as ClientConfig;
    expect(() => upsertInstance(root, invalid)).toThrow(/package.*directory/i);
    expect(existsSync(join(root, "config.json"))).toBe(false);
    expect(existsSync(join(root, ".env"))).toBe(false);
    expect(existsSync(join(root, ".atom"))).toBe(false);

    expect(() => upsertInstance(root, {
      id: "both",
      package: { id: "pkg", version: "1.0.0" },
      directory: "./both",
      stdio: "inherit",
    })).toThrow(/package.*directory/i);
  });

  test("a held lock blocks writes without changing config, env, or state", () => {
    const root = sandbox();
    upsertInstance(root, { id: "existing", directory: "./existing", stdio: "inherit" }, { token: "old" });
    const configBefore = readFileSync(join(root, "config.json"), "utf8");
    const envBefore = readFileSync(join(root, ".env"), "utf8");
    const revisionBefore = readConfigRevision(root);
    const lockPath = join(root, ".atom/gateway/config.lock");
    writeFileSync(lockPath, "999\n");

    expect(() => upsertInstance(root, {
      id: "new",
      directory: "./new",
      stdio: "inherit",
    }, { token: "new" })).toThrow(/Gateway config is locked/);

    expect(readFileSync(join(root, "config.json"), "utf8")).toBe(configBefore);
    expect(readFileSync(join(root, ".env"), "utf8")).toBe(envBefore);
    expect(readConfigRevision(root)).toBe(revisionBefore);
    expect(existsSync(lockPath)).toBe(true);
  });

  test("rolls back env and config when the state write fails", () => {
    const root = sandbox();
    upsertInstance(root, { id: "existing", directory: "./existing", stdio: "inherit" }, { token: "old" });
    const configBefore = readFileSync(join(root, "config.json"), "utf8");
    const envBefore = readFileSync(join(root, ".env"), "utf8");
    const revisionBefore = readConfigRevision(root);
    const failState: InstanceFileWriter = (path, data, options) => {
      if (path.endsWith("state.json")) throw new Error("state write failed");
      writeFileAtomic(path, data, options);
    };

    expect(() => upsertInstance(
      root,
      { id: "new", directory: "./new", stdio: "inherit" },
      { token: "new" },
      { writeFile: failState },
    )).toThrow("state write failed");

    expect(readFileSync(join(root, "config.json"), "utf8")).toBe(configBefore);
    expect(readFileSync(join(root, ".env"), "utf8")).toBe(envBefore);
    expect(readConfigRevision(root)).toBe(revisionBefore);
    expect(existsSync(join(root, ".atom/gateway/config.lock"))).toBe(false);
  });

  test("releases the lock when the mutation fails", () => {
    const root = sandbox();
    upsertInstance(root, { id: "keep", directory: "./keep", stdio: "inherit" });

    expect(() => removeInstance(root, "ghost")).toThrow("Unknown client instance: ghost");
    expect(() => upsertInstance(root, { id: "next", directory: "./next", stdio: "inherit" })).not.toThrow();
    expect(configOf(root).gateway.clients.map((client: ClientConfig) => client.id)).toEqual(["keep", "next"]);
  });

  test("refuses to write beside legacy entries", () => {
    const root = sandbox();
    writeFileSync(join(root, "config.json"), JSON.stringify({
      gateway: { clients: [{ id: "legacy", binary: "./legacy" }] },
    }));
    const before = readFileSync(join(root, "config.json"), "utf8");

    expect(() => upsertInstance(root, { id: "new", directory: "./new", stdio: "inherit" }))
      .toThrow(/binary.*package.*directory/i);
    expect(readFileSync(join(root, "config.json"), "utf8")).toBe(before);
    expect(existsSync(join(root, ".env"))).toBe(false);
    expect(readConfigRevision(root)).toBe(0);
  });
});

describe("config revision", () => {
  test("starts at 0 and increments on every successful upsert or remove", () => {
    const root = sandbox();
    expect(readConfigRevision(root)).toBe(0);

    upsertInstance(root, { id: "a", directory: "./a", stdio: "inherit" });
    expect(readConfigRevision(root)).toBe(1);

    upsertInstance(root, { id: "b", directory: "./b", stdio: "inherit" });
    expect(readConfigRevision(root)).toBe(2);

    removeInstance(root, "a");
    expect(readConfigRevision(root)).toBe(3);
    expect(JSON.parse(readFileSync(join(root, ".atom/gateway/state.json"), "utf8"))).toEqual({
      version: 1,
      configRevision: 3,
    });

    writeFileSync(join(root, ".atom/gateway/state.json"), "{broken");
    expect(readConfigRevision(root)).toBe(0);
  });
});

describe("listInstances", () => {
  test("returns valid entries and reports invalid legacy entries with index and id", () => {
    const root = sandbox();
    upsertInstance(root, { id: "a", directory: "./a", stdio: "inherit" });
    upsertInstance(root, { id: "b", directory: "./b", stdio: "ignore" });
    expect(listInstances(root).map(instance => instance.id)).toEqual(["a", "b"]);

    writeFileSync(join(root, "config.json"), JSON.stringify({
      gateway: {
        clients: [
          { id: "a", directory: "./a", stdio: "inherit" },
          { id: "legacy", binary: "./legacy" },
        ],
      },
    }));
    expect(() => listInstances(root)).toThrow(/index 1[\s\S]*legacy[\s\S]*binary/i);
  });

  test("reports an invalid config.json clearly", () => {
    const root = sandbox();
    writeFileSync(join(root, "config.json"), "{not json");
    expect(() => listInstances(root)).toThrow(/Invalid config\.json/);

    writeFileSync(join(root, "config.json"), "[]");
    expect(() => listInstances(root)).toThrow(/expected a JSON object/);
  });
});

describe("removeInstance", () => {
  test("removes only the target, keeps env credentials, and increments revision", () => {
    const root = sandbox();
    upsertInstance(root, { id: "keep", directory: "./keep", stdio: "inherit" }, { token: "keep-secret" });
    upsertInstance(root, { id: "drop", directory: "./drop", stdio: "inherit" }, { token: "drop-secret" });

    removeInstance(root, "drop");

    expect(configOf(root).gateway.clients.map((client: ClientConfig) => client.id)).toEqual(["keep"]);
    expect(envOf(root).ATOM_CLIENT_KEEP_TOKEN).toBe("keep-secret");
    expect(envOf(root).ATOM_CLIENT_DROP_TOKEN).toBe("drop-secret");
    expect(readConfigRevision(root)).toBe(3);

    expect(() => removeInstance(root, "ghost")).toThrow("Unknown client instance: ghost");
    expect(readConfigRevision(root)).toBe(3);
    expect(configOf(root).gateway.clients.map((client: ClientConfig) => client.id)).toEqual(["keep"]);
  });
});

describe("missing config", () => {
  test("a missing config.json is created with defaults ConfigSchema can read", () => {
    const root = sandbox();
    upsertInstance(root, { id: "bot", package: { id: "pkg", version: "1.0.0" }, stdio: "inherit" });

    const parsed = ConfigSchema.parse(configOf(root));
    expect(parsed.version).toBe(2);
    expect(parsed.gateway.port).toBe(3000);
    expect(parsed.gateway.clients[0]?.id).toBe("bot");
    expect(listInstances(root).map(instance => instance.id)).toEqual(["bot"]);
  });
});
