import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "gateway-release.ts");
const HOST = `${process.platform}-${process.arch}`;
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-gateway-release-test-"));
  tempDirs.push(dir);
  return dir;
}

function createClient(): string {
  const root = tempDir();
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(
    join(root, "manifest.json"),
    `${JSON.stringify({
      manifest_version: 1,
      id: "echo-bot",
      name: "Echo Bot",
      version: "1.0.0",
      platform: "echo",
      entry: { production: ["bin/echo-bot"] },
    }, null, 2)}\n`,
  );
  writeFileSync(join(root, "bin", "echo-bot"), "#!/bin/sh\necho echo-bot\n", { mode: 0o755 });
  return root;
}

function releaseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ATOM_GATEWAY_SOURCE_BASE_URL;
  return env;
}

function runRelease(args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: releaseEnv(),
    timeout: 30_000,
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("gateway-release", () => {
  test("packs the current host archive and writes a matching source index", () => {
    const client = createClient();
    const out = join(tempDir(), "dist", "gateway");
    const result = runRelease([
      "--no-build",
      "--client",
      client,
      "--base-url",
      "https://example.invalid",
      "--out",
      out,
    ]);

    if (result.status !== 0) {
      throw new Error(`gateway-release failed:\n${result.stderr || result.stdout}`);
    }

    const archive = join(out, `echo-bot-1.0.0-${HOST}.tar.gz`);
    const indexPath = join(out, "gateway-source-index.json");
    expect(existsSync(archive)).toBe(true);
    expect(existsSync(indexPath)).toBe(true);

    const archiveBytes = readFileSync(archive);
    const expectedEntry = {
      id: "echo-bot",
      version: "1.0.0",
      target: HOST,
      url: `https://example.invalid/echo-bot-1.0.0-${HOST}.tar.gz`,
      sha256: createHash("sha256").update(archiveBytes).digest("hex"),
      size: statSync(archive).size,
    };
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    expect(index).toEqual({ version: 1, entries: [expectedEntry] });

    const summary = JSON.parse(result.stdout);
    expect(summary).toEqual({ archive, index: indexPath, entry: expectedEntry, entries: 1 });
  });

  test("merges other target entries, stays idempotent, and rejects same-key conflicts", () => {
    const client = createClient();
    const out = join(tempDir(), "dist", "gateway");
    const indexPath = join(out, "gateway-source-index.json");
    const otherTarget = HOST === "linux-x64" ? "darwin-arm64" : "linux-x64";
    const otherEntry = {
      id: "echo-bot",
      version: "1.0.0",
      target: otherTarget,
      url: `https://example.invalid/echo-bot-1.0.0-${otherTarget}.tar.gz`,
      sha256: "b".repeat(64),
    };
    mkdirSync(out, { recursive: true });
    writeFileSync(indexPath, JSON.stringify({ version: 1, entries: [otherEntry] }));

    const args = [
      "--no-build", "--client", client, "--base-url", "https://example.invalid", "--out", out,
    ];
    const first = runRelease(args);
    if (first.status !== 0) throw new Error(first.stderr || first.stdout);
    const merged = JSON.parse(readFileSync(indexPath, "utf8")) as { entries: Array<{ target: string }> };
    expect(merged.entries.map(entry => entry.target).sort()).toEqual([HOST, otherTarget].sort());

    const second = runRelease(args);
    if (second.status !== 0) throw new Error(second.stderr || second.stdout);
    expect(JSON.parse(readFileSync(indexPath, "utf8")).entries).toHaveLength(2);

    const conflict = {
      ...otherEntry,
      target: HOST,
      url: `https://example.invalid/conflict-${HOST}.tar.gz`,
      sha256: "c".repeat(64),
    };
    writeFileSync(indexPath, JSON.stringify({ version: 1, entries: [otherEntry, conflict] }));
    const rejected = runRelease(args);
    expect(rejected.status).not.toBe(0);
    expect(`${rejected.stderr}${rejected.stdout}`).toContain("Conflicting source index entry");
    expect(JSON.parse(readFileSync(indexPath, "utf8")).entries).toHaveLength(2);
  });

  test("fails when no base URL is provided", () => {
    const client = createClient();
    const out = join(tempDir(), "dist", "gateway");
    const result = runRelease(["--no-build", "--client", client, "--out", out]);

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toContain("--base-url");
    expect(existsSync(join(out, `echo-bot-1.0.0-${HOST}.tar.gz`))).toBe(false);
  });
});
