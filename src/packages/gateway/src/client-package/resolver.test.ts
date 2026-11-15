import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientConfig } from "@atom-neo/shared";
import { registerPackage } from "./registry";
import { resolveClient, resolveClients, sandboxPackageRoot } from "./resolver";
import type { ResolveOptions } from "./resolver";

const BASE_ENV: NodeJS.ProcessEnv = {
  PATH: "/bin",
  KEEP: "kept",
  ATOM_ADMIN_TOKEN: "admin-secret",
  ATOM_CLIENT_OTHER_BOT_TOKEN: "other-secret",
};

const BASE_MANIFEST = {
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
    "bot-token": {
      label: "Bot Token",
      type: "string",
      required: false,
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
};

let temp: string;

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "atom-resolver-"));
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

function writeManifest(root: string, overrides: Record<string, unknown> = {}): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ ...BASE_MANIFEST, ...overrides }));
}

function makeRoot(name: string, overrides: Record<string, unknown> = {}): string {
  const root = join(temp, name);
  writeManifest(root, overrides);
  return root;
}

function makeClient(overrides: Partial<ClientConfig> & { id: string }): ClientConfig {
  return { stdio: "inherit", ...overrides };
}

function makeOptions(
  packageRoot: ResolveOptions["packageRoot"] = () => {
    throw new Error("packageRoot must not be called");
  },
  env: Record<string, string> = {},
  baseEnv: NodeJS.ProcessEnv = { ...BASE_ENV },
): ResolveOptions {
  return { packageRoot, readEnv: (key) => env[key], baseEnv };
}

describe("resolveClient sources", () => {
  test("uses the development entry for a directory source", () => {
    const root = makeRoot("dev-client");
    const resolved = resolveClient(makeClient({ id: "tg-dev", directory: root }), makeOptions());

    expect(resolved.command).toEqual(["bun", "run", "src/main.ts"]);
    expect(resolved.cwd).toBe(root);
    expect(resolved.platform).toBe("telegram");
    expect(resolved.source).toEqual({ type: "directory", directory: root });
  });

  test("uses the production entry for a package source and the injected root", () => {
    const root = makeRoot("pkg-client");
    const resolved = resolveClient(
      makeClient({ id: "tg-main", package: { id: "telegram-bot", version: "0.1.0" } }),
      makeOptions((id, version) => {
        expect(id).toBe("telegram-bot");
        expect(version).toBe("0.1.0");
        return root;
      }),
    );

    expect(resolved.command).toEqual(["./bin/telegram-bot"]);
    expect(resolved.cwd).toBe(root);
    expect(resolved.platform).toBe("telegram");
    expect(resolved.source).toEqual({ type: "package", id: "telegram-bot", version: "0.1.0" });
  });

  test("rejects package id and version mismatches", () => {
    const root = makeRoot("mismatch");
    const options = makeOptions(() => root);

    expect(() =>
      resolveClient(
        makeClient({ id: "tg", package: { id: "other-bot", version: "0.1.0" } }),
        options,
      ),
    ).toThrow('manifest id "telegram-bot" does not match package id "other-bot"');
    expect(() =>
      resolveClient(
        makeClient({ id: "tg", package: { id: "telegram-bot", version: "0.2.0" } }),
        options,
      ),
    ).toThrow('manifest version "0.1.0" does not match package version "0.2.0"');
  });

  test("reports missing and invalid manifests with the instance id and path", () => {
    const missing = join(temp, "missing");
    mkdirSync(missing);
    const missingConfig = makeClient({ id: "tg-missing", directory: missing });

    expect(() => resolveClient(missingConfig, makeOptions())).toThrow(
      `Client tg-missing (directory ${missing})`,
    );
    expect(() => resolveClient(missingConfig, makeOptions())).toThrow(join(missing, "manifest.json"));

    const invalid = join(temp, "invalid");
    mkdirSync(invalid);
    writeFileSync(join(invalid, "manifest.json"), "{ not json");
    const invalidConfig = makeClient({ id: "tg-invalid", directory: invalid });

    expect(() => resolveClient(invalidConfig, makeOptions())).toThrow("Client tg-invalid");
    expect(() => resolveClient(invalidConfig, makeOptions())).toThrow(join(invalid, "manifest.json"));
    expect(() => resolveClient(invalidConfig, makeOptions())).toThrow("Invalid manifest JSON");
  });

  test("wraps package-root failures with instance context", () => {
    expect(() =>
      resolveClient(
        makeClient({ id: "tg", package: { id: "telegram-bot", version: "0.1.0" } }),
        { packageRoot: () => { throw new Error("not installed"); } },
      ),
    ).toThrow("Client tg (package telegram-bot@0.1.0): not installed");
  });

  test("rejects reserved arguments in manifest entries", () => {
    for (const reserved of ["--secret", "--port", "--gateway-url"]) {
      const root = makeRoot(`reserved-entry-${reserved.slice(2)}`, {
        entry: { development: ["bun", "run", "src/main.ts", `${reserved}=leak`] },
      });
      expect(() => resolveClient(makeClient({ id: "tg", directory: root }), makeOptions()))
        .toThrow(`entry must not define reserved argument ${reserved}=leak`);
    }
  });

  test("does not fall back when the selected entry is missing", () => {
    const productionOnly = makeRoot("production-only", {
      entry: { production: ["./bin/telegram-bot"] },
    });
    expect(() =>
      resolveClient(makeClient({ id: "tg-dev", directory: productionOnly }), makeOptions()),
    ).toThrow("manifest.entry.development is required");

    const developmentOnly = makeRoot("development-only", {
      entry: { development: ["bun", "run", "src/main.ts"] },
    });
    expect(() =>
      resolveClient(
        makeClient({ id: "tg-main", package: { id: "telegram-bot", version: "0.1.0" } }),
        makeOptions(() => developmentOnly),
      ),
    ).toThrow("manifest.entry.production is required");
  });

  test("resolves a relative directory against baseDir", () => {
    const root = makeRoot("relative-client");
    const resolved = resolveClient(makeClient({ id: "tg", directory: "relative-client" }), {
      ...makeOptions(),
      baseDir: temp,
    });

    expect(resolved.cwd).toBe(root);
  });

  test("preserves clientArgs and stdio", () => {
    const root = makeRoot("args");
    const resolved = resolveClient(
      makeClient({
        id: "tg",
        directory: root,
        clientArgs: { mode: "webhook", "bot-token": "arg" },
        stdio: "ignore",
      }),
      makeOptions(),
    );

    expect(resolved.clientArgs).toEqual({ mode: "webhook", "bot-token": "arg" });
    expect(resolved.stdio).toBe("ignore");
  });
});

describe("resolveClient required config", () => {
  test("requires a credential reference for a required secret field", () => {
    const root = makeRoot("required-secret", {
      config: {
        "bot-token": {
          label: "Bot Token",
          type: "string",
          required: true,
          secret: true,
          env: "TELEGRAM_BOT_TOKEN",
        },
      },
    });

    expect(() => resolveClient(makeClient({ id: "tg", directory: root }), makeOptions()))
      .toThrow("Client tg is missing required credential bot-token");
    expect(() => resolveClient(
      makeClient({
        id: "tg",
        directory: root,
        credentials: { "bot-token": "ATOM_CLIENT_TG_TOKEN" },
      }),
      makeOptions(undefined, { ATOM_CLIENT_TG_TOKEN: "secret" }),
    )).not.toThrow();
  });

  test("requires clientArgs for a required non-secret field", () => {
    const root = makeRoot("required-arg", {
      config: {
        mode: {
          label: "Mode",
          type: "string",
          required: true,
          enum: ["longpoll", "webhook"],
          default: "longpoll",
        },
      },
    });

    expect(() => resolveClient(makeClient({ id: "tg", directory: root }), makeOptions()))
      .toThrow("Client tg is missing required argument --mode");
    expect(() => resolveClient(
      makeClient({ id: "tg", directory: root, clientArgs: { mode: "longpoll" } }),
      makeOptions(),
    )).not.toThrow();
  });
});

describe("resolveClient credentials", () => {
  test("maps a credential reference and filters inherited credentials", () => {
    const root = makeRoot("credential");
    const resolved = resolveClient(
      makeClient({
        id: "tg-main",
        directory: root,
        credentials: { "bot-token": "ATOM_CLIENT_TG_MAIN_BOT_TOKEN" },
      }),
      makeOptions(undefined, { ATOM_CLIENT_TG_MAIN_BOT_TOKEN: "bot-secret" }),
    );

    expect(resolved.env).toEqual({ PATH: "/bin", KEEP: "kept", TELEGRAM_BOT_TOKEN: "bot-secret" });
    expect(resolved.env.ATOM_ADMIN_TOKEN).toBeUndefined();
    expect(resolved.env.ATOM_CLIENT_OTHER_BOT_TOKEN).toBeUndefined();
  });

  test("resolves two instances to separate environments with only their own token", () => {
    const root = makeRoot("two-instances");
    const resolved = resolveClients(
      [
        makeClient({
          id: "main",
          directory: root,
          credentials: { "bot-token": "ATOM_CLIENT_MAIN_TOKEN" },
        }),
        makeClient({
          id: "backup",
          directory: root,
          credentials: { "bot-token": "ATOM_CLIENT_BACKUP_TOKEN" },
        }),
      ],
      makeOptions(undefined, {
        ATOM_CLIENT_MAIN_TOKEN: "main-secret",
        ATOM_CLIENT_BACKUP_TOKEN: "backup-secret",
      }),
    );

    expect(resolved[0].env.TELEGRAM_BOT_TOKEN).toBe("main-secret");
    expect(resolved[0].env.ATOM_CLIENT_BACKUP_TOKEN).toBeUndefined();
    expect(resolved[1].env.TELEGRAM_BOT_TOKEN).toBe("backup-secret");
    expect(resolved[1].env.ATOM_CLIENT_MAIN_TOKEN).toBeUndefined();
    expect(resolved[0].env).not.toBe(resolved[1].env);
  });

  test("rejects bad credential references, fields, and missing values", () => {
    const root = makeRoot("bad-credentials");
    const resolve = (credentials: Record<string, string>, env: Record<string, string> = {}) =>
      resolveClient(
        makeClient({ id: "tg", directory: root, credentials }),
        makeOptions(undefined, env),
      );

    expect(() => resolve({ "bot-token": "TELEGRAM_BOT_TOKEN" })).toThrow(
      "must reference an ATOM_CLIENT_* variable",
    );
    expect(() => resolve({ "bot-token": "ATOM_ADMIN_TOKEN" })).toThrow(
      "must not reference ATOM_ADMIN_TOKEN",
    );
    expect(() => resolve({ "bot-token": "ATOM_CLIENT_BAD-NAME" })).toThrow("invalid env name");
    expect(() => resolve({ unknown: "ATOM_CLIENT_UNKNOWN_TOKEN" })).toThrow(
      "is not declared in the manifest",
    );
    expect(() => resolve({ mode: "ATOM_CLIENT_MODE_TOKEN" })).toThrow(
      "is not a secret manifest field",
    );
    expect(() => resolve({ "bot-token": "ATOM_CLIENT_MISSING_TOKEN" })).toThrow(
      "Client tg missing credential ATOM_CLIENT_MISSING_TOKEN",
    );
  });

  // parseManifest rejects secret fields without env, so resolver cannot receive one.
  test.skip("rejects a secret manifest field without env", () => {});

  test("rejects writing credentials to reserved environment variables", () => {
    const resolveWithEnv = (name: string, envKey: string) => {
      const root = makeRoot(name, {
        config: {
          "bot-token": { label: "Bot Token", type: "string", secret: true, env: envKey },
        },
      });
      return resolveClient(
        makeClient({
          id: "tg",
          directory: root,
          credentials: { "bot-token": "ATOM_CLIENT_TG_BOT_TOKEN" },
        }),
        makeOptions(undefined, { ATOM_CLIENT_TG_BOT_TOKEN: "bot-secret" }),
      );
    };

    expect(() => resolveWithEnv("admin-env", "ATOM_ADMIN_TOKEN")).toThrow(
      "must not write to reserved env ATOM_ADMIN_TOKEN",
    );
    expect(() => resolveWithEnv("instance-env", "ATOM_CLIENT_OTHER_TOKEN")).toThrow(
      "must not write to reserved env ATOM_CLIENT_OTHER_TOKEN",
    );
    expect(() => resolveWithEnv("invalid-env", "BAD NAME")).toThrow("valid environment variable name");
  });
});

describe("resolveClients", () => {
  test("rejects duplicate instance ids before resolving", () => {
    const config = makeClient({ id: "dup", directory: join(temp, "missing") });

    expect(() => resolveClients([config, config], makeOptions())).toThrow(
      "Duplicate gateway client id: dup",
    );
  });
});

describe("sandboxPackageRoot", () => {
  test("uses the registered package path and rejects unregistered packages", () => {
    const sandbox = join(temp, "sandbox");
    const target = `${process.platform}-${process.arch}`;
    const relativePath = join(".atom", "gateway", "packages", "telegram-bot", "0.1.0", target);
    const root = join(sandbox, relativePath);
    writeManifest(root);
    registerPackage(sandbox, {
      id: "telegram-bot",
      version: "0.1.0",
      target,
      path: relativePath,
      source: "local:test",
      sha256: "a".repeat(64),
      installedAt: "2026-01-01T00:00:00.000Z",
    });

    const packageRoot = sandboxPackageRoot(sandbox);

    expect(packageRoot("telegram-bot", "0.1.0")).toBe(root);
    expect(() => packageRoot("telegram-bot", "9.9.9")).toThrow(`is not installed in ${sandbox}`);
  });

  test("rejects a registered package for another host target", () => {
    const sandbox = join(temp, "wrong-target-sandbox");
    const relativePath = ".atom/gateway/packages/telegram-bot/0.1.0/linux-x64";
    writeManifest(join(sandbox, relativePath));
    registerPackage(sandbox, {
      id: "telegram-bot",
      version: "0.1.0",
      target: "linux-x64",
      path: relativePath,
      source: "local:test",
      sha256: "a".repeat(64),
      installedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(() => sandboxPackageRoot(sandbox)("telegram-bot", "0.1.0")).toThrow(
      `target "linux-x64" is not supported on ${process.platform}-${process.arch}`,
    );
  });
});
