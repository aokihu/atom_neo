import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  findPackage,
  listPackages,
  readRegistry,
  registerPackage,
  registryPath,
  removePackage,
} from "./registry";
import type { PackageRegistration } from "./registry";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-registry-"));
  tempDirs.push(dir);
  return dir;
}

function makeRegistration(
  overrides: Partial<PackageRegistration> & Pick<PackageRegistration, "id" | "version">,
): PackageRegistration {
  return {
    target: "darwin-arm64",
    path: `.atom/gateway/packages/${overrides.id}/${overrides.version}/darwin-arm64`,
    source: "local:./package.tar.gz",
    sha256: SHA_A,
    ...overrides,
  };
}

function readRaw(dir: string): string {
  return readFileSync(registryPath(dir), "utf8");
}

function writeConfig(dir: string, clients: unknown[]): void {
  writeFileSync(join(dir, "config.json"), `${JSON.stringify({ gateway: { clients } }, null, 2)}\n`);
}

const REGISTRY_MODULE_URL = new URL("./registry.ts", import.meta.url).href;
const FILE_LOCK_MODULE_URL = new URL("../../../shared/src/utils/file-lock.ts", import.meta.url).href;

type ChildResult = { code: number; stderr: string };

function registryLockPath(dir: string): string {
  return join(dir, ".atom", "gateway", "packages.lock");
}

function writeRegistryForTest(dir: string, text: string): void {
  const path = registryPath(dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function holdRegistryLock(dir: string): string {
  const path = registryLockPath(dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "999\n");
  return path;
}

function script(body: string): string {
  return `(async () => {\n${body}\n})().catch((error) => {\n  console.error(error);\n  process.exit(1);\n});`;
}

function registrationScript(dir: string, registration: PackageRegistration): string {
  return script(`
  const { registerPackage } = await import(${JSON.stringify(REGISTRY_MODULE_URL)});
  registerPackage(${JSON.stringify(dir)}, ${JSON.stringify(registration)}, {
    lock: { timeoutMs: 10_000, retryMs: 10 },
  });
`);
}

async function collect(child: { exited: Promise<number>; stderr: ReadableStream }): Promise<ChildResult> {
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { code, stderr };
}

async function runRegistration(dir: string, registration: PackageRegistration): Promise<ChildResult> {
  return collect(Bun.spawn([process.execPath, "-e", registrationScript(dir, registration)], {
    stdout: "ignore",
    stderr: "pipe",
  }));
}

function expectChildSucceeded(result: ChildResult): void {
  if (result.code !== 0) throw new Error(`Child process failed (${result.code}): ${result.stderr}`);
}

function waitForPath(path: string, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}

describe("readRegistry", () => {
  test("returns an empty registry when packages.json is missing", () => {
    const dir = sandbox();

    expect(readRegistry(dir)).toEqual({ version: 1, packages: {} });
    expect(findPackage(dir, "demo", "1.0.0")).toBeUndefined();
    expect(listPackages(dir)).toEqual([]);
  });

  test("rejects invalid JSON, unsupported versions, and malformed shapes", () => {
    const dir = sandbox();
    const path = registryPath(dir);
    mkdirSync(dirname(path), { recursive: true });

    writeFileSync(path, "{ not json");
    expect(() => readRegistry(dir)).toThrow(`Invalid packages.json at ${path}`);

    writeFileSync(path, "[]");
    expect(() => readRegistry(dir)).toThrow("expected a JSON object");

    writeFileSync(path, JSON.stringify({ version: 2, packages: {} }));
    expect(() => readRegistry(dir)).toThrow("Unsupported packages.json version");

    writeFileSync(path, JSON.stringify({ version: 1, packages: [] }));
    expect(() => readRegistry(dir)).toThrow(`Invalid packages.json at ${path}`);

    writeFileSync(path, JSON.stringify({ version: 1, packages: { demo: { "1.0.0": { target: "x" } } } }));
    expect(() => readRegistry(dir)).toThrow("installedAt");

    expect(() => registerPackage(dir, makeRegistration({ id: "demo", version: "1.0.0" })))
      .toThrow("Invalid packages.json");
    expect(() => removePackage(dir, "demo", "1.0.0")).toThrow("Invalid packages.json");
  });
});

describe("registerPackage", () => {
  test("registers, reads, finds, and lists one package", () => {
    const dir = sandbox();
    const record = registerPackage(dir, makeRegistration({
      id: "demo",
      version: "1.0.0",
      installedAt: "2026-01-01T00:00:00.000Z",
    }));

    expect(record).toEqual({
      target: "darwin-arm64",
      path: ".atom/gateway/packages/demo/1.0.0/darwin-arm64",
      source: "local:./package.tar.gz",
      installedAt: "2026-01-01T00:00:00.000Z",
      sha256: SHA_A,
    });
    expect(readRegistry(dir)).toEqual({ version: 1, packages: { demo: { "1.0.0": record } } });
    expect(findPackage(dir, "demo", "1.0.0")).toEqual(record);
    expect(findPackage(dir, "demo", "2.0.0")).toBeUndefined();
    expect(findPackage(dir, "other", "1.0.0")).toBeUndefined();
    expect(listPackages(dir)).toEqual([{ id: "demo", version: "1.0.0", record }]);
  });

  test("defaults installedAt to an ISO timestamp", () => {
    const dir = sandbox();
    const record = registerPackage(dir, makeRegistration({ id: "demo", version: "1.0.0" }));

    expect(record.installedAt).toBe(new Date(record.installedAt).toISOString());
  });

  test("re-registering identical content is idempotent and preserves installedAt", () => {
    const dir = sandbox();
    const first = registerPackage(dir, makeRegistration({
      id: "demo",
      version: "1.0.0",
      installedAt: "2026-01-01T00:00:00.000Z",
    }));
    const raw = readRaw(dir);

    const second = registerPackage(dir, makeRegistration({
      id: "demo",
      version: "1.0.0",
      source: "local:./other.tar.gz",
      installedAt: "2030-01-01T00:00:00.000Z",
    }));

    expect(second).toEqual(first);
    expect(second.installedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(second.source).toBe("local:./package.tar.gz");
    expect(readRaw(dir)).toBe(raw);
  });

  test("rejects the same version with different content and leaves the registry unchanged", () => {
    const dir = sandbox();
    const base = makeRegistration({ id: "demo", version: "1.0.0", installedAt: "2026-01-01T00:00:00.000Z" });
    registerPackage(dir, base);
    const raw = readRaw(dir);

    for (const overrides of [
      { sha256: SHA_B },
      { target: "linux-x64" },
      { path: ".atom/gateway/packages/demo/1.0.0/linux-x64" },
    ]) {
      expect(() => registerPackage(dir, makeRegistration({ ...base, ...overrides })))
        .toThrow("Package demo@1.0.0 already installed with different content");
      expect(readRaw(dir)).toBe(raw);
    }
  });

  test("keeps other packages and versions intact", () => {
    const dir = sandbox();
    registerPackage(dir, makeRegistration({ id: "zeta", version: "1.0.0" }));
    registerPackage(dir, makeRegistration({ id: "alpha", version: "1.0.0" }));
    registerPackage(dir, makeRegistration({ id: "alpha", version: "0.2.0" }));

    expect(listPackages(dir).map(({ id, version }) => `${id}@${version}`)).toEqual([
      "alpha@0.2.0",
      "alpha@1.0.0",
      "zeta@1.0.0",
    ]);
    const registry = readRegistry(dir);
    expect(Object.keys(registry.packages)).toEqual(["zeta", "alpha"]);
    expect(Object.keys(registry.packages.alpha!)).toEqual(["1.0.0", "0.2.0"]);
    expect(findPackage(dir, "zeta", "1.0.0")).toBeDefined();
    expect(findPackage(dir, "alpha", "0.2.0")).toBeDefined();
  });

  test("writes stable, valid JSON and leaves no temporary files", () => {
    const dir = sandbox();
    const record = registerPackage(dir, makeRegistration({
      id: "demo",
      version: "1.0.0",
      installedAt: "2026-01-01T00:00:00.000Z",
    }));
    const raw = readRaw(dir);

    expect(raw).toBe(`${JSON.stringify({ version: 1, packages: { demo: { "1.0.0": record } } }, null, 2)}\n`);
    expect(JSON.parse(raw)).toEqual(readRegistry(dir));
    expect(readdirSync(dirname(registryPath(dir))).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});

describe("removePackage", () => {
  test("rejects unknown packages without writing", () => {
    const dir = sandbox();
    registerPackage(dir, makeRegistration({ id: "demo", version: "1.0.0" }));
    const raw = readRaw(dir);

    expect(() => removePackage(dir, "ghost", "1.0.0")).toThrow("Package ghost@1.0.0 is not installed");
    expect(() => removePackage(dir, "demo", "2.0.0")).toThrow("Package demo@2.0.0 is not installed");
    expect(readRaw(dir)).toBe(raw);
  });

  test("rejects packages referenced by a package client but ignores directory clients", () => {
    const dir = sandbox();
    registerPackage(dir, makeRegistration({ id: "demo", version: "1.0.0" }));
    registerPackage(dir, makeRegistration({ id: "demo", version: "2.0.0" }));
    registerPackage(dir, makeRegistration({ id: "other", version: "1.0.0" }));
    writeConfig(dir, [
      { id: "tg", package: { id: "demo", version: "1.0.0" } },
      { id: "dev", directory: "/tmp/dev-client" },
    ]);

    const raw = readRaw(dir);
    expect(() => removePackage(dir, "demo", "1.0.0"))
      .toThrow("Package demo@1.0.0 is referenced by client tg");
    expect(readRaw(dir)).toBe(raw);

    expect(() => removePackage(dir, "demo", "2.0.0")).not.toThrow();
    expect(findPackage(dir, "demo", "1.0.0")).toBeDefined();
    expect(findPackage(dir, "demo", "2.0.0")).toBeUndefined();
    expect(findPackage(dir, "other", "1.0.0")).toBeDefined();
  });

  test("prunes empty maps and leaves package files untouched", () => {
    const dir = sandbox();
    for (const version of ["1.0.0", "2.0.0"]) {
      registerPackage(dir, makeRegistration({ id: "demo", version }));
      const root = join(dir, ".atom", "gateway", "packages", "demo", version, "darwin-arm64");
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "manifest.json"), "{}");
    }
    registerPackage(dir, makeRegistration({ id: "keep", version: "1.0.0" }));

    removePackage(dir, "demo", "1.0.0");
    let registry = readRegistry(dir);
    expect(Object.keys(registry.packages.demo!)).toEqual(["2.0.0"]);

    removePackage(dir, "demo", "2.0.0");
    registry = readRegistry(dir);
    expect(registry.packages.demo).toBeUndefined();
    expect(Object.keys(registry.packages)).toEqual(["keep"]);
    expect(readRaw(dir).endsWith("\n")).toBe(true);

    for (const version of ["1.0.0", "2.0.0"]) {
      expect(existsSync(join(dir, ".atom", "gateway", "packages", "demo", version, "darwin-arm64", "manifest.json")))
        .toBe(true);
    }
  });
});

describe("registry locking", () => {
  test("a held lock times out without changing the registry", () => {
    const dir = sandbox();
    registerPackage(dir, makeRegistration({ id: "demo", version: "1.0.0" }));
    const raw = readRaw(dir);
    const lockPath = holdRegistryLock(dir);
    const started = Date.now();

    expect(() => registerPackage(dir, makeRegistration({ id: "other", version: "1.0.0" }), {
      lock: { timeoutMs: 50, retryMs: 10 },
    })).toThrow(`Package registry is locked: ${lockPath}`);

    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    expect(readRaw(dir)).toBe(raw);
    expect(existsSync(lockPath)).toBe(true);

    rmSync(lockPath, { force: true });
    registerPackage(dir, makeRegistration({ id: "other", version: "1.0.0" }));
    expect(findPackage(dir, "other", "1.0.0")).toBeDefined();
  });

  test("waits for a held lock to be released, then registers", async () => {
    const dir = sandbox();
    const lockPath = registryLockPath(dir);
    const holder = Bun.spawn([process.execPath, "-e", script(`
  const { withFileLock } = await import(${JSON.stringify(FILE_LOCK_MODULE_URL)});
  withFileLock(${JSON.stringify(lockPath)}, () => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  });
`)], { stdout: "ignore", stderr: "pipe" });

    try {
      waitForPath(lockPath, 2_000);
      const started = Date.now();
      const record = registerPackage(dir, makeRegistration({ id: "demo", version: "1.0.0" }), {
        lock: { timeoutMs: 2_000, retryMs: 10 },
      });

      expect(Date.now() - started).toBeGreaterThanOrEqual(100);
      expect(findPackage(dir, "demo", "1.0.0")).toEqual(record);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      expectChildSucceeded(await collect(holder));
    }
  });

  test("a held lock blocks removal without changing the registry", () => {
    const dir = sandbox();
    const record = registerPackage(dir, makeRegistration({ id: "demo", version: "1.0.0" }));
    const raw = readRaw(dir);
    const lockPath = holdRegistryLock(dir);

    expect(() => removePackage(dir, "demo", "1.0.0", { lock: { timeoutMs: 50, retryMs: 10 } }))
      .toThrow(`Package registry is locked: ${lockPath}`);
    expect(readRaw(dir)).toBe(raw);
    expect(findPackage(dir, "demo", "1.0.0")).toEqual(record);
    expect(existsSync(lockPath)).toBe(true);

    rmSync(lockPath, { force: true });
    removePackage(dir, "demo", "1.0.0");
    expect(findPackage(dir, "demo", "1.0.0")).toBeUndefined();
  });

  test("releases the lock when register or remove fails", () => {
    const dir = sandbox();
    const path = registryPath(dir);
    const lockPath = registryLockPath(dir);
    writeRegistryForTest(dir, "{broken");

    expect(() => registerPackage(dir, makeRegistration({ id: "demo", version: "1.0.0" })))
      .toThrow("Invalid packages.json");
    expect(existsSync(lockPath)).toBe(false);

    writeRegistryForTest(dir, `${JSON.stringify({ version: 1, packages: {} })}\n`);
    const record = registerPackage(dir, makeRegistration({ id: "demo", version: "1.0.0" }));
    expect(findPackage(dir, "demo", "1.0.0")).toEqual(record);

    writeRegistryForTest(dir, "{broken");
    expect(() => removePackage(dir, "demo", "1.0.0")).toThrow("Invalid packages.json");
    expect(existsSync(lockPath)).toBe(false);

    writeRegistryForTest(dir, `${JSON.stringify({ version: 1, packages: { demo: { "1.0.0": record } } }, null, 2)}\n`);
    removePackage(dir, "demo", "1.0.0");
    expect(findPackage(dir, "demo", "1.0.0")).toBeUndefined();
    expect(existsSync(path)).toBe(true);
  });

  test("concurrent registrations from separate processes keep both records", async () => {
    const dir = sandbox();
    const [first, second] = await Promise.all([
      runRegistration(dir, makeRegistration({ id: "alpha", version: "1.0.0" })),
      runRegistration(dir, makeRegistration({ id: "beta", version: "1.0.0" })),
    ]);

    expectChildSucceeded(first);
    expectChildSucceeded(second);
    expect(readRegistry(dir).version).toBe(1);
    expect(listPackages(dir).map(({ id, version }) => `${id}@${version}`)).toEqual([
      "alpha@1.0.0",
      "beta@1.0.0",
    ]);
    expect(readdirSync(dirname(registryPath(dir))).filter((name) => name.includes(".tmp-"))).toEqual([]);
    expect(existsSync(registryLockPath(dir))).toBe(false);
  });

  test("concurrent same-version content conflicts leave one valid record", async () => {
    const dir = sandbox();
    const [first, second] = await Promise.all([
      runRegistration(dir, makeRegistration({ id: "demo", version: "1.0.0", sha256: SHA_A })),
      runRegistration(dir, makeRegistration({ id: "demo", version: "1.0.0", sha256: SHA_B })),
    ]);

    expect([first.code, second.code].filter((code) => code === 0)).toHaveLength(1);
    expect([first.code, second.code].filter((code) => code !== 0)).toHaveLength(1);
    const failed = first.code === 0 ? second : first;
    expect(failed.stderr).toContain("already installed with different content");

    expect(listPackages(dir)).toHaveLength(1);
    const record = findPackage(dir, "demo", "1.0.0");
    expect(record).toBeDefined();
    expect([SHA_A, SHA_B]).toContain(record!.sha256);
    expect(existsSync(registryLockPath(dir))).toBe(false);
  });
});
