/** M1 integration: directory/package resolution through ClientManager with a fake runtime. */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientConfigSchema, Logger } from "@atom-neo/shared";
import type { ClientConfig } from "@atom-neo/shared";
import { ClientManager } from "../client-manager";
import { createFakeRuntime } from "../client-manager/test-helpers";
import { loadGatewayConfig } from "../config";
import { buildClientArgs } from "../client-manager/client-command";
import { resolveClient, sandboxPackageRoot } from "./resolver";

const tempDirs: string[] = [];

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-client-package-"));
  tempDirs.push(dir);
  return dir;
}

function writeManifest(root: string, manifest: Record<string, unknown>): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function managerFor(clients: ClientConfig[], resolved: ReturnType<typeof resolveClient>[]) {
  const fake = createFakeRuntime();
  const config = loadGatewayConfig({ port: 3_000, clients, clientPortRangeStart: 4_200 });
  const manager = new ClientManager(config, resolved, new Logger("error", () => {}), fake.runtime);
  return { fake, manager };
}

describe("M1 resolved client integration", () => {
  test("starts a development directory with cwd, platform, args and isolated env", async () => {
    const root = sandbox();
    writeManifest(root, {
      manifest_version: 1,
      id: "local-dev",
      name: "Local Dev",
      version: "0.1.0",
      platform: "local",
      entry: { development: ["bun", "run", "src/main.ts"] },
    });

    const client: ClientConfig = { id: "dev", directory: root, clientArgs: { mode: "fast" }, stdio: "inherit" };
    const resolved = resolveClient(client, {
      packageRoot: () => { throw new Error("directory must not use packageRoot"); },
      baseEnv: { PATH: "/bin", ATOM_ADMIN_TOKEN: "admin", ATOM_CLIENT_OTHER_KEY: "other" },
    });
    expect(resolved.command).toEqual(["bun", "run", "src/main.ts"]);
    expect(resolved.cwd).toBe(root);
    expect(resolved.platform).toBe("local");
    expect(resolved.env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(resolved.env.ATOM_ADMIN_TOKEN).toBeUndefined();
    expect(resolved.env.ATOM_CLIENT_OTHER_KEY).toBeUndefined();

    const { fake, manager } = managerFor([client], [resolved]);
    await manager.startAll();

    const call = fake.spawnCalls[0]!;
    expect(call.command).toEqual([
      "bun", "run", "src/main.ts",
      "--secret", manager.getById("dev")!.secret,
      "--port", "4200",
      "--gateway-url", "http://127.0.0.1:3000",
      "--mode", "fast",
    ]);
    expect(call.options?.cwd).toBe(root);
    expect(call.options?.env?.ATOM_ADMIN_TOKEN).toBeUndefined();
    expect(call.options?.env?.ATOM_CLIENT_OTHER_KEY).toBeUndefined();

    await manager.stopAll();
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("starts an installed package through the production entry", async () => {
    const sandboxPath = sandbox();
    const root = join(sandboxPath, ".atom/gateway/packages/local-package/0.2.0", `${process.platform}-${process.arch}`);
    writeManifest(root, {
      manifest_version: 1,
      id: "local-package",
      name: "Local Package",
      version: "0.2.0",
      platform: "local",
      entry: { production: ["./bin/local-package"] },
      target: `${process.platform}-${process.arch}`,
    });

    const client: ClientConfig = { id: "pkg", package: { id: "local-package", version: "0.2.0" }, stdio: "inherit" };
    const resolved = resolveClient(client, { packageRoot: sandboxPackageRoot(sandboxPath) });
    expect(resolved.command).toEqual(["./bin/local-package"]);
    expect(resolved.cwd).toBe(root);
    expect(resolved.source).toEqual({ type: "package", id: "local-package", version: "0.2.0" });

    const { fake, manager } = managerFor([client], [resolved]);
    await manager.startAll();
    expect(fake.spawnCalls[0]?.command.slice(0, 1)).toEqual(["./bin/local-package"]);
    expect(fake.spawnCalls[0]?.options?.cwd).toBe(root);
    await manager.stopAll();
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("rejects legacy binary configuration with a migration hint", () => {
    const parsed = ClientConfigSchema.safeParse({ id: "legacy", platform: "local", binary: "./bot" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some(issue => /binary.*package.*directory/i.test(issue.message))).toBe(true);
    }
    expect(() => loadGatewayConfig({
      clients: [{ id: "legacy", platform: "local", binary: "./bot" } as unknown as ClientConfig],
    })).toThrow(/binary.*package.*directory/i);
  });

  test("injects only the target instance credentials", () => {
    const root = sandbox();
    writeManifest(root, {
      manifest_version: 1,
      id: "credential-test",
      name: "Credential Test",
      version: "0.1.0",
      platform: "telegram",
      entry: { development: ["bun", "run", "src/main.ts"] },
      config: {
        "bot-token": { label: "Bot Token", type: "string", required: true, secret: true, env: "TELEGRAM_BOT_TOKEN" },
      },
    });
    const values: Record<string, string> = {
      ATOM_CLIENT_MAIN_BOT_TOKEN: "main-token",
      ATOM_CLIENT_OTHER_BOT_TOKEN: "other-token",
      ATOM_ADMIN_TOKEN: "admin-token",
    };
    const baseEnv = { PATH: "/bin", ...values };
    const readEnv = (key: string) => values[key];

    const main = resolveClient({
      id: "main",
      directory: root,
      credentials: { "bot-token": "ATOM_CLIENT_MAIN_BOT_TOKEN" },
      stdio: "inherit",
    }, { packageRoot: () => root, baseEnv, readEnv });
    const other = resolveClient({
      id: "other",
      directory: root,
      credentials: { "bot-token": "ATOM_CLIENT_OTHER_BOT_TOKEN" },
      stdio: "inherit",
    }, { packageRoot: () => root, baseEnv, readEnv });

    expect(main.env.TELEGRAM_BOT_TOKEN).toBe("main-token");
    expect(other.env.TELEGRAM_BOT_TOKEN).toBe("other-token");
    for (const env of [main.env, other.env]) {
      expect(env.ATOM_ADMIN_TOKEN).toBeUndefined();
      expect(Object.keys(env).some(key => key.startsWith("ATOM_CLIENT_"))).toBe(false);
    }
  });

  test("keeps reserved argument protection and refuses development-only packages", () => {
    for (const reserved of ["secret", "port", "gateway-url"]) {
      expect(() => buildClientArgs({ [reserved]: "x" })).toThrow(/reserved/);
    }

    const root = sandbox();
    writeManifest(root, {
      manifest_version: 1,
      id: "dev-only",
      name: "Dev Only",
      version: "0.1.0",
      platform: "local",
      entry: { development: ["bun", "run", "src/main.ts"] },
    });
    expect(() => resolveClient({ id: "dev-only", directory: root, stdio: "inherit" }, {
      packageRoot: () => root,
    })).not.toThrow();
    expect(() => resolveClient({ id: "dev-only", package: { id: "dev-only", version: "0.1.0" }, stdio: "inherit" }, {
      packageRoot: () => root,
    })).toThrow(/production/);
  });
});
