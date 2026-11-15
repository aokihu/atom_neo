import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, extract, list } from "tar";
import { installClient, packClient } from "./archive";
import { findPackage, readRegistry } from "./registry";

const STAGE_PREFIX = "atom-client-pack-";
const tempDirs: string[] = [];

const baseManifest = {
  manifest_version: 1,
  id: "telegram-bot",
  name: "Telegram Bot",
  version: "0.1.0",
  platform: "telegram",
  entry: { production: ["./bin/telegram-bot"] },
};

function tempDir(prefix = "atom-pack-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeManifest(root: string, overrides: Record<string, unknown> = {}): void {
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ ...baseManifest, ...overrides }));
}

function createClient(overrides: Record<string, unknown> = {}, production?: string[]): string {
  const root = tempDir();
  mkdirSync(join(root, "bin"), { recursive: true });
  writeManifest(root, {
    ...overrides,
    ...(production === undefined ? {} : { entry: { production } }),
  });
  writeFileSync(join(root, "bin", "telegram-bot"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return root;
}

function createSensitiveSources(root: string): void {
  writeFileSync(join(root, ".env"), "SECRET=root");
  writeFileSync(join(root, ".env.local"), "SECRET=local");
  writeFileSync(join(root, "debug.log"), "root log");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "main.ts"), "console.log('source')");
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(root, "node_modules", "dep", "index.js"), "module.exports = {}");
  writeFileSync(join(root, "bin", ".env"), "SECRET=bin");
  writeFileSync(join(root, "bin", ".env.production"), "SECRET=production");
  writeFileSync(join(root, "bin", "debug.log"), "bin log");
}

async function archiveEntries(file: string): Promise<string[]> {
  const entries: string[] = [];
  await list({
    file,
    onReadEntry: (entry) => {
      entries.push(entry.path.replace(/\/+$/, ""));
    },
  });
  return entries;
}

async function packedManifest(file: string): Promise<Record<string, unknown>> {
  const dir = tempDir();
  await extract({ file, cwd: dir, strict: true }, ["manifest.json"]);
  return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")) as Record<string, unknown>;
}

function packagePath(sandbox: string, id = "telegram-bot", version = "0.1.0", target = `${process.platform}-${process.arch}`): string {
  return join(sandbox, ".atom", "gateway", "packages", id, version, target);
}

function installTemps(sandbox: string): string[] {
  const dir = join(sandbox, ".atom", "gateway", "tmp");
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith("install-")) : [];
}

async function writeRawArchive(
  file: string,
  mutate?: (entry: { path: string; type?: string; linkpath?: string }) => void,
  manifest: Record<string, unknown> = baseManifest,
  target: string | null = `${process.platform}-${process.arch}`,
): Promise<void> {
  const stage = tempDir();
  mkdirSync(join(stage, "bin"), { recursive: true });
  writeFileSync(join(stage, "manifest.json"), JSON.stringify({ ...manifest, ...(target === null ? {} : { target }) }));
  writeFileSync(join(stage, "bin", "telegram-bot"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await create({
    cwd: stage,
    file,
    gzip: true,
    portable: true,
    onWriteEntry: mutate as never,
  }, ["manifest.json", "bin"]);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("packClient", () => {
  test("packs manifest and bin only, injecting the default target", async () => {
    const root = createClient();
    createSensitiveSources(root);
    writeFileSync(join(root, "bin", "assets.txt"), "asset");

    const target = `${process.platform}-${process.arch}`;
    const out = await packClient(root);

    expect(out).toBe(join(root, "dist", `telegram-bot-0.1.0-${target}.tar.gz`));
    expect(existsSync(out)).toBe(true);

    const entries = await archiveEntries(out);
    expect(entries).toContain("manifest.json");
    expect(entries).toContain("bin");
    expect(entries).toContain("bin/telegram-bot");
    expect(entries).toContain("bin/assets.txt");
    expect(entries.every((entry) => entry === "manifest.json" || entry === "bin" || entry.startsWith("bin/"))).toBe(true);

    expect(entries.some((entry) => entry.includes("src/"))).toBe(false);
    expect(entries.some((entry) => entry.includes("node_modules"))).toBe(false);
    expect(entries.some((entry) => entry.endsWith(".log"))).toBe(false);
    const names = entries.flatMap((entry) => entry.split("/"));
    expect(names).not.toContain(".env");
    expect(names).not.toContain(".env.production");

    expect((await packedManifest(out)).target).toBe(target);
    expect(JSON.parse(readFileSync(join(root, "manifest.json"), "utf-8")).target).toBeUndefined();
  });

  test("writes an explicit output path relative to cwd and creates parents", async () => {
    const root = createClient();
    const out = join(tempDir(), "nested", "packed", "client.tar.gz");

    expect(await packClient(root, { out })).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(existsSync(join(root, "dist"))).toBe(false);
    expect(await archiveEntries(out)).toContain("manifest.json");
  });

  test("rejects a manifest without entry.production", async () => {
    const root = tempDir();
    writeManifest(root, { entry: { development: ["bun", "src/main.ts"] } });

    await expect(packClient(root)).rejects.toThrow("manifest.entry.production is required");
    expect(existsSync(join(root, "dist"))).toBe(false);
  });

  describe("production executable", () => {
    async function expectRejected(production: string | ((root: string) => string), message: RegExp) {
      const root = createClient();
      const token = typeof production === "function" ? production(root) : production;
      writeManifest(root, { entry: { production: [token] } });
      await expect(packClient(root)).rejects.toThrow(message);
      expect(existsSync(join(root, "dist"))).toBe(false);
    }

    test("rejects absolute paths", async () => {
      await expectRejected((root) => join(root, "bin", "telegram-bot"), /relative and under bin/);
    });

    test("rejects parent traversal and paths outside bin", async () => {
      await expectRejected("../bin/telegram-bot", /must not contain "\.\."/);
      await expectRejected("src/main.ts", /under bin/);
      await expectRejected("bin", /under bin/);
    });

    test("rejects a missing file", async () => {
      await expectRejected("./bin/missing", /does not exist/);
    });

    test("rejects a non-regular file", async () => {
      const root = createClient();
      mkdirSync(join(root, "bin", "folder"));
      writeManifest(root, { entry: { production: ["./bin/folder"] } });
      await expect(packClient(root)).rejects.toThrow(/regular file/);
    });

    test("rejects a symlink", async () => {
      const root = createClient();
      symlinkSync("telegram-bot", join(root, "bin", "link"));
      writeManifest(root, { entry: { production: ["./bin/link"] } });
      await expect(packClient(root)).rejects.toThrow(/symlink/);
    });
  });

  test("rejects a requested target that conflicts with manifest.target", async () => {
    const root = createClient({ target: "linux-x64" });

    await expect(packClient(root, { target: "darwin-arm64" })).rejects.toThrow(
      'manifest.target "linux-x64" does not match requested target "darwin-arm64"',
    );
    expect(existsSync(join(root, "dist"))).toBe(false);
  });

  test("rejects an invalid target", async () => {
    const root = createClient();

    await expect(packClient(root, { target: "Darwin arm64" })).rejects.toThrow(/invalid target/);
  });

  test("rejects symlinks inside bin", async () => {
    const root = createClient();
    writeFileSync(join(root, "outside.txt"), "do not pack");
    symlinkSync("../outside.txt", join(root, "bin", "outside-link"));

    await expect(packClient(root)).rejects.toThrow(/cannot pack symlink bin\/outside-link/);
    expect(existsSync(join(root, "dist"))).toBe(false);
  });

  test("failure leaves no output archive, temp file, or staging directory", async () => {
    const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith(STAGE_PREFIX)));
    const root = createClient();
    symlinkSync("telegram-bot", join(root, "bin", "bad-link"));
    const target = `${process.platform}-${process.arch}`;
    const out = join(root, "dist", `telegram-bot-0.1.0-${target}.tar.gz`);

    await expect(packClient(root)).rejects.toThrow(/symlink/);

    expect(existsSync(out)).toBe(false);
    if (existsSync(join(root, "dist"))) {
      expect(readdirSync(join(root, "dist"))).toEqual([]);
    }
    const leakedStages = readdirSync(tmpdir()).filter(
      (name) => name.startsWith(STAGE_PREFIX) && !before.has(name),
    );
    expect(leakedStages).toEqual([]);
  });

  test("uses an explicit target when the manifest omits target", async () => {
    const root = createClient({}, ["bin/telegram-bot"]);

    const out = await packClient(root, { target: "linux-x64" });

    expect(out).toBe(join(root, "dist", "telegram-bot-0.1.0-linux-x64.tar.gz"));
    expect((await packedManifest(out)).target).toBe("linux-x64");
  });

  test("uses manifest.target when no target is requested", async () => {
    const root = createClient({ target: "custom-target" });

    const out = await packClient(root);

    expect(out).toBe(join(root, "dist", "telegram-bot-0.1.0-custom-target.tar.gz"));
    expect((await packedManifest(out)).target).toBe("custom-target");
  });
});

describe("installClient", () => {
  test("installs a packed client, records it, and is idempotent for the same content", async () => {
    const root = createClient();
    const sandbox = tempDir();
    const archive = await packClient(root);
    const target = `${process.platform}-${process.arch}`;

    const first = await installClient(sandbox, archive);
    expect(first).toMatchObject({
      target,
      path: join(".atom", "gateway", "packages", "telegram-bot", "0.1.0", target),
      source: archive,
    });
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(join(packagePath(sandbox), "manifest.json"))).toBe(true);
    expect(readFileSync(join(packagePath(sandbox), "bin", "telegram-bot"), "utf8")).toContain("exit 0");
    expect(findPackage(sandbox, "telegram-bot", "0.1.0")).toEqual(first);
    expect(readRegistry(sandbox).packages["telegram-bot"]?.["0.1.0"]).toEqual(first);

    const second = await installClient(sandbox, archive);
    expect(second).toEqual(first);
    expect(installTemps(sandbox)).toEqual([]);
  });

  test("rejects a different payload for an already installed version without overwriting", async () => {
    const root = createClient();
    const sandbox = tempDir();
    const archive = await packClient(root);
    const first = await installClient(sandbox, archive);
    const installedBinary = join(packagePath(sandbox), "bin", "telegram-bot");
    const before = readFileSync(installedBinary, "utf8");

    writeFileSync(join(root, "bin", "telegram-bot"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const changed = await packClient(root, { out: join(tempDir(), "changed.tar.gz") });

    await expect(installClient(sandbox, changed)).rejects.toThrow(
      "Package telegram-bot@0.1.0 is already installed with different content",
    );
    expect(readFileSync(installedBinary, "utf8")).toBe(before);
    expect(findPackage(sandbox, "telegram-bot", "0.1.0")).toEqual(first);
    expect(installTemps(sandbox)).toEqual([]);
  });

  test("rejects an existing package directory without a registry record", async () => {
    const root = createClient();
    const sandbox = tempDir();
    const archive = await packClient(root);
    mkdirSync(packagePath(sandbox), { recursive: true });

    await expect(installClient(sandbox, archive)).rejects.toThrow("refusing to overwrite");
    expect(installTemps(sandbox)).toEqual([]);
  });

  test("rejects unsupported and missing targets", async () => {
    const root = createClient();
    const sandbox = tempDir();
    const archive = await packClient(root, { target: "custom-target" });
    await expect(installClient(sandbox, archive)).rejects.toThrow(
      `unsupported package target "custom-target"; this host is ${process.platform}-${process.arch}`,
    );
    expect(existsSync(join(sandbox, ".atom", "gateway", "packages"))).toBe(false);

    const missingTarget = join(tempDir(), "missing-target.tar.gz");
    await writeRawArchive(missingTarget, undefined, baseManifest, null);
    await expect(installClient(sandbox, missingTarget)).rejects.toThrow("manifest.target is required");
    expect(installTemps(sandbox)).toEqual([]);
  });

  test("rejects missing or invalid production entries", async () => {
    const sandbox = tempDir();
    for (const production of ["./bin/missing", "src/main.ts", "../bin/telegram-bot"]) {
      const archive = join(tempDir(), "invalid-production.tar.gz");
      await writeRawArchive(archive, undefined, {
        ...baseManifest,
        entry: { production: [production] },
      });
      await expect(installClient(sandbox, archive)).rejects.toThrow();
      expect(existsSync(join(sandbox, ".atom", "gateway", "packages"))).toBe(false);
      expect(installTemps(sandbox)).toEqual([]);
    }
  });

  test("rejects traversal, absolute paths, extra top-level entries and symlinks", async () => {
    const sandbox = tempDir();
    const archives: string[] = [];

    for (const path of ["../escape", "/absolute"]) {
      const archive = join(tempDir(), `bad-path-${archives.length}.tar.gz`);
      await writeRawArchive(archive, (entry) => {
        if (entry.path === "manifest.json") entry.path = path;
      });
      archives.push(archive);
    }

    const extra = join(tempDir(), "extra.tar.gz");
    await writeRawArchive(extra, (entry) => {
      if (entry.path === "bin/telegram-bot") entry.path = "extra.txt";
    });
    archives.push(extra);

    const sensitive = join(tempDir(), "sensitive.tar.gz");
    await writeRawArchive(sensitive, (entry) => {
      if (entry.path === "bin/telegram-bot") entry.path = "bin/.env";
    });
    archives.push(sensitive);

    const symlink = join(tempDir(), "symlink.tar.gz");
    const symlinkStage = tempDir();
    mkdirSync(join(symlinkStage, "bin"), { recursive: true });
    writeFileSync(join(symlinkStage, "manifest.json"), JSON.stringify({ ...baseManifest, target: `${process.platform}-${process.arch}` }));
    symlinkSync("../outside", join(symlinkStage, "bin", "link"));
    await create({ cwd: symlinkStage, file: symlink, gzip: true }, ["manifest.json", "bin"]);
    archives.push(symlink);

    for (const archive of archives) {
      await expect(installClient(sandbox, archive)).rejects.toThrow();
      expect(existsSync(join(sandbox, ".atom", "gateway", "packages"))).toBe(false);
      expect(installTemps(sandbox)).toEqual([]);
    }
  });

  test("rolls back the committed directory when registry writing fails", async () => {
    const root = createClient();
    const sandbox = tempDir();
    const archive = await packClient(root);
    mkdirSync(join(sandbox, ".atom", "gateway", "packages.json"), { recursive: true });

    await expect(installClient(sandbox, archive)).rejects.toThrow();
    expect(existsSync(packagePath(sandbox))).toBe(false);
    expect(installTemps(sandbox)).toEqual([]);
  });
});
