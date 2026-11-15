import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { credentialRef, listInstances, upsertInstance } from "@atom-neo/shared";
import type { ClientConfig } from "@atom-neo/shared";
import { upgradeClientInstance } from "./gateway-upgrade";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-gateway-upgrade-test-"));
  tempDirs.push(dir);
  return dir;
}

function packageInstance(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    id: "telegram-main",
    package: { id: "telegram-bot", version: "1.0.0" },
    clientArgs: { mode: "polling" },
    credentials: { botToken: credentialRef("telegram-main", "botToken") },
    stdio: "ignore",
    ...overrides,
  };
}

function seed(instance: ClientConfig): string {
  const sandbox = tempDir();
  upsertInstance(sandbox, instance);
  return sandbox;
}

function instanceOf(sandbox: string, id = "telegram-main"): ClientConfig {
  const instance = listInstances(sandbox).find((entry) => entry.id === id);
  if (instance === undefined) throw new Error(`missing instance ${id}`);
  return instance;
}

describe("upgradeClientInstance", () => {
  test("switches the package version, applies it, and preserves credentials and client args", async () => {
    const original = packageInstance();
    const sandbox = seed(original);
    let applies = 0;
    const apply = async (): Promise<"reloaded"> => {
      applies++;
      return "reloaded";
    };

    const result = await upgradeClientInstance(sandbox, "telegram-main", "2.0.0", { apply });

    expect(result).toEqual({
      id: "telegram-main",
      packageId: "telegram-bot",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      changed: true,
      applied: "reloaded",
      rolledBack: false,
    });
    expect(applies).toBe(1);

    const updated = instanceOf(sandbox);
    expect(updated.package).toEqual({ id: "telegram-bot", version: "2.0.0" });
    expect(updated.credentials).toEqual(original.credentials);
    expect(updated.clientArgs).toEqual(original.clientArgs);
    expect(updated.stdio).toBe("ignore");
  });

  test("restores the previous version and config when apply fails", async () => {
    const original = packageInstance();
    const sandbox = seed(original);
    const apply = async (): Promise<"reloaded"> => {
      throw new Error("reload request timed out");
    };

    await expect(
      upgradeClientInstance(sandbox, "telegram-main", "2.0.0", { apply }),
    ).rejects.toThrow(
      'Upgrade of client "telegram-main" to telegram-bot@2.0.0 failed: reload request timed out; old version telegram-bot@1.0.0 restored',
    );

    const restored = instanceOf(sandbox);
    expect(restored.package).toEqual({ id: "telegram-bot", version: "1.0.0" });
    expect(restored.credentials).toEqual(original.credentials);
    expect(restored.clientArgs).toEqual(original.clientArgs);
    expect(restored.stdio).toBe("ignore");
  });

  test("reports an unchanged version but still applies when requested", async () => {
    const sandbox = seed(packageInstance());
    let applies = 0;
    const apply = async (): Promise<"registered"> => {
      applies++;
      return "registered";
    };

    const result = await upgradeClientInstance(sandbox, "telegram-main", "1.0.0", { apply });

    expect(result.changed).toBe(false);
    expect(result.applied).toBe("registered");
    expect(result.rolledBack).toBe(false);
    expect(applies).toBe(1);
    expect(instanceOf(sandbox).package).toEqual({ id: "telegram-bot", version: "1.0.0" });
  });

  test("rejects directory instances without converting them", async () => {
    const sandbox = tempDir();
    const directory = join(sandbox, "clients", "dir-bot");
    upsertInstance(sandbox, { id: "dir-bot", directory, stdio: "inherit" });

    await expect(upgradeClientInstance(sandbox, "dir-bot", "2.0.0")).rejects.toThrow(
      /uses a directory source/,
    );
    expect(instanceOf(sandbox, "dir-bot")).toEqual({ id: "dir-bot", directory, stdio: "inherit" });
  });

  test("rejects unknown instances", async () => {
    await expect(upgradeClientInstance(tempDir(), "missing", "2.0.0")).rejects.toThrow(
      "Unknown client instance: missing",
    );
  });
});
