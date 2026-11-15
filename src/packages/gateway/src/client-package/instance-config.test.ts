import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { credentialRef, listInstances, parseEnv } from "@atom-neo/shared";
import { configureInstance } from "./instance-config";
import { parseManifest } from "./manifest";
import { registerPackage } from "./registry";

const TARGET = `${process.platform}-${process.arch}`;
const SHA = "a".repeat(64);
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-instance-config-"));
  tempDirs.push(dir);
  return dir;
}

function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifest_version: 1,
    id: "telegram-bot",
    name: "Telegram Bot",
    version: "0.1.0",
    platform: "telegram",
    entry: {
      production: ["./bin/telegram-bot"],
      development: ["bun", "run", "src/main.ts"],
    },
    config: {
      botToken: {
        label: "Bot Token",
        type: "string",
        required: true,
        secret: true,
        env: "TELEGRAM_BOT_TOKEN",
      },
      mode: {
        label: "Mode",
        type: "string",
        enum: ["longpoll", "webhook"],
        default: "longpoll",
      },
    },
    ...overrides,
  };
}

function writeManifest(root: string, manifest: Record<string, unknown>): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function installPackage(
  dir: string,
  overrides: Record<string, unknown> = {},
  identity: { id?: string; version?: string; target?: string } = {},
): { root: string; manifest: Record<string, unknown> } {
  const id = identity.id ?? "telegram-bot";
  const version = identity.version ?? "0.1.0";
  const target = identity.target ?? TARGET;
  const manifest = baseManifest({ id, version, target, ...overrides });
  const relative = join(".atom", "gateway", "packages", id, version, target);
  const root = join(dir, relative);

  writeManifest(root, manifest);
  registerPackage(dir, {
    id,
    version,
    target,
    path: relative,
    source: "local:test",
    sha256: SHA,
  });
  return { root, manifest };
}

function configOf(dir: string): any {
  return JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
}

function envOf(dir: string): Record<string, string> {
  return parseEnv(readFileSync(join(dir, ".env"), "utf8"));
}

function expectNoWrites(dir: string): void {
  expect(existsSync(join(dir, "config.json"))).toBe(false);
  expect(existsSync(join(dir, ".env"))).toBe(false);
}

describe("configureInstance package source", () => {
  test("writes a package client, args, credential ref and .env value", () => {
    const dir = sandbox();
    const { root } = installPackage(dir);

    const result = configureInstance({
      sandbox: dir,
      id: "tg-main",
      source: { type: "package", id: "telegram-bot", version: "0.1.0" },
      values: { botToken: "123:secret", mode: "webhook" },
    });

    expect(result.saved).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.configPath).toBe(join(dir, "config.json"));
    expect(result.envPath).toBe(join(dir, ".env"));
    expect(result.manifest).toEqual(parseManifest(readFileSync(join(root, "manifest.json"), "utf8")));
    expect(result.client).toEqual({
      id: "tg-main",
      package: { id: "telegram-bot", version: "0.1.0" },
      clientArgs: { mode: "webhook" },
      stdio: "inherit",
    });

    const ref = credentialRef("tg-main", "botToken");
    expect(configOf(dir).gateway.clients).toEqual([{
      id: "tg-main",
      package: { id: "telegram-bot", version: "0.1.0" },
      clientArgs: { mode: "webhook" },
      credentials: { botToken: ref },
      stdio: "inherit",
    }]);
    expect(envOf(dir)[ref]).toBe("123:secret");
  });
});

describe("configureInstance directory source", () => {
  test("resolves a relative path and persists an absolute directory", () => {
    const dir = sandbox();
    const relative = "clients/dev-bot";
    writeManifest(join(dir, relative), baseManifest({ id: "dev-bot", config: undefined }));

    const result = configureInstance({
      sandbox: dir,
      id: "dev",
      source: { type: "directory", path: relative },
    });

    const absolute = resolve(dir, relative);
    expect(result.client).toEqual({ id: "dev", directory: absolute, stdio: "inherit" });
    expect(result.envPath).toBeUndefined();
    expect(configOf(dir).gateway.clients[0]).toEqual({
      id: "dev",
      directory: absolute,
      stdio: "inherit",
    });
  });
});

describe("configureInstance validation", () => {
  test("rejects a missing required secret without writing config or .env", () => {
    const dir = sandbox();
    writeManifest(join(dir, "clients/bot"), baseManifest());

    expect(() => configureInstance({
      sandbox: dir,
      id: "bot",
      source: { type: "directory", path: "clients/bot" },
    })).toThrow("Client bot is missing required credential botToken");

    expectNoWrites(dir);
  });

  test("rejects a missing required non-secret even when a default exists", () => {
    const dir = sandbox();
    writeManifest(join(dir, "clients/bot"), baseManifest({
      config: {
        mode: {
          label: "Mode",
          type: "string",
          required: true,
          enum: ["fast", "slow"],
          default: "fast",
        },
      },
    }));

    expect(() => configureInstance({
      sandbox: dir,
      id: "bot",
      source: { type: "directory", path: "clients/bot" },
    })).toThrow("Client bot is missing required argument --mode");
    expectNoWrites(dir);

    const result = configureInstance({
      sandbox: dir,
      id: "bot",
      source: { type: "directory", path: "clients/bot" },
      values: { mode: "fast" },
    });
    expect(result.client.clientArgs).toEqual({ mode: "fast" });
  });

  test("rejects an invalid enum before writes and applies an omitted default", () => {
    const dir = sandbox();
    writeManifest(join(dir, "clients/bot"), baseManifest());

    expect(() => configureInstance({
      sandbox: dir,
      id: "bot",
      source: { type: "directory", path: "clients/bot" },
      values: { botToken: "super-secret-token", mode: "carrier-pigeon" },
    })).toThrow("Client bot argument --mode must be one of: longpoll, webhook");
    expectNoWrites(dir);

    const result = configureInstance({
      sandbox: dir,
      id: "bot",
      source: { type: "directory", path: "clients/bot" },
      values: { botToken: "super-secret-token" },
    });
    expect(result.client.clientArgs).toEqual({ mode: "longpoll" });
    expect(configOf(dir).gateway.clients[0].clientArgs).toEqual({ mode: "longpoll" });
  });

  test("ignores values that the manifest does not declare", () => {
    const dir = sandbox();
    writeManifest(join(dir, "clients/bot"), baseManifest());

    const result = configureInstance({
      sandbox: dir,
      id: "bot",
      source: { type: "directory", path: "clients/bot" },
      values: { botToken: "token", mode: "webhook", unknown: "ignored", extraSecret: "ignored" },
    });

    expect(result.client.credentials).toBeUndefined();
    expect(result.client.clientArgs).toEqual({ mode: "webhook" });
    const persisted = configOf(dir).gateway.clients[0];
    expect(persisted.clientArgs).toEqual({ mode: "webhook" });
    expect(persisted.credentials).toEqual({ botToken: credentialRef("bot", "botToken") });
    expect(Object.keys(envOf(dir))).toEqual([credentialRef("bot", "botToken")]);
  });

  test("omits optional empty values from args and secrets", () => {
    const dir = sandbox();
    const baseConfig = baseManifest().config as Record<string, unknown>;
    writeManifest(join(dir, "clients/bot"), baseManifest({
      config: {
        ...baseConfig,
        webhookSecret: {
          label: "Webhook Secret",
          type: "string",
          secret: true,
          env: "TELEGRAM_WEBHOOK_SECRET",
        },
        webhookUrl: { label: "Webhook URL", type: "string" },
      },
    }));

    const result = configureInstance({
      sandbox: dir,
      id: "bot",
      source: { type: "directory", path: "clients/bot" },
      values: { botToken: "token", mode: "", webhookSecret: "", webhookUrl: "" },
    });

    expect(result.client.clientArgs).toBeUndefined();
    const persisted = configOf(dir).gateway.clients[0];
    expect(persisted.clientArgs).toBeUndefined();
    expect(persisted.credentials).toEqual({ botToken: credentialRef("bot", "botToken") });
    expect(Object.keys(envOf(dir))).toEqual([credentialRef("bot", "botToken")]);
  });
});

describe("configureInstance package validation", () => {
  test("rejects a package that is not installed", () => {
    const dir = sandbox();

    expect(() => configureInstance({
      sandbox: dir,
      id: "bot",
      source: { type: "package", id: "ghost", version: "1.0.0" },
    })).toThrow("Client package ghost@1.0.0 is not installed");
    expectNoWrites(dir);
  });

  test("rejects manifest id, version and target mismatches", () => {
    const wrongId = sandbox();
    installPackage(wrongId, { id: "other-bot" });
    expect(() => configureInstance({
      sandbox: wrongId,
      id: "bot",
      source: { type: "package", id: "telegram-bot", version: "0.1.0" },
    })).toThrow('manifest id "other-bot" does not match package id "telegram-bot"');
    expectNoWrites(wrongId);

    const wrongVersion = sandbox();
    installPackage(wrongVersion, { version: "9.9.9" });
    expect(() => configureInstance({
      sandbox: wrongVersion,
      id: "bot",
      source: { type: "package", id: "telegram-bot", version: "0.1.0" },
    })).toThrow('manifest version "9.9.9" does not match package version "0.1.0"');
    expectNoWrites(wrongVersion);

    const wrongTarget = sandbox();
    installPackage(wrongTarget, { target: "linux-x64" });
    expect(() => configureInstance({
      sandbox: wrongTarget,
      id: "bot",
      source: { type: "package", id: "telegram-bot", version: "0.1.0" },
    })).toThrow(`manifest target "linux-x64" does not match installed target "${TARGET}"`);
    expectNoWrites(wrongTarget);

    const unstamped = sandbox();
    installPackage(unstamped, { target: undefined });
    expect(() => configureInstance({
      sandbox: unstamped,
      id: "bot",
      source: { type: "package", id: "telegram-bot", version: "0.1.0" },
    })).toThrow("manifest target is missing; installed packages must be target-stamped");
    expectNoWrites(unstamped);
  });
});

describe("configureInstance listInstances round trip", () => {
  test("package and directory clients are readable with the expected shapes", () => {
    const dir = sandbox();
    installPackage(dir);

    configureInstance({
      sandbox: dir,
      id: "pkg-bot",
      source: { type: "package", id: "telegram-bot", version: "0.1.0" },
      values: { botToken: "package-secret", mode: "webhook" },
      stdio: "inherit",
    });

    writeManifest(join(dir, "clients/dev-bot"), baseManifest({ id: "dev-bot", config: undefined }));
    configureInstance({
      sandbox: dir,
      id: "dev-bot",
      source: { type: "directory", path: "clients/dev-bot" },
      stdio: "ignore",
    });

    const instances = listInstances(dir);
    expect(instances.map((instance) => instance.id)).toEqual(["pkg-bot", "dev-bot"]);
    expect(instances[0]).toEqual({
      id: "pkg-bot",
      package: { id: "telegram-bot", version: "0.1.0" },
      clientArgs: { mode: "webhook" },
      credentials: { botToken: credentialRef("pkg-bot", "botToken") },
      stdio: "inherit",
    });
    expect(instances[1]).toEqual({
      id: "dev-bot",
      directory: resolve(dir, "clients/dev-bot"),
      stdio: "ignore",
    });
  });
});
