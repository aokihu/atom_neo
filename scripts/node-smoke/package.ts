/**
 * S10-B2 tarball install smoke.
 *
 * Builds `dist/node`, packs the root package with npm (no prepack), inspects
 * the tarball, installs it into a throwaway npm project, then runs the
 * installed entrypoint and a real Core health/stop cycle under Node >= 26.
 *
 * Usage:
 *   bun run smoke:node:package
 */
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MAIN = join(ROOT, "dist/node/main.js");
const WATCHDOG_MS = 300_000;
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 15_000;
let passed = 0;

type CommandResult = { stdout: string; stderr: string };
type RuntimeFile = { url: string; token: string; instanceId: string };

function pass(name: string): void {
  passed++;
  console.log(`PASS ${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

async function waitFor<T>(check: () => T | undefined, timeoutMs: number, label: string): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = check();
    if (value !== undefined) return value;
    await sleep(50);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function run(label: string, command: string[], cwd = ROOT): CommandResult {
  console.log(`[smoke:node:package] ${label}: ${command.join(" ")}`);
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (result.exitCode !== 0) {
    console.error(stdout.trim());
    console.error(stderr.trim());
    throw new Error(`${label} failed (exit ${result.exitCode})`);
  }
  return { stdout, stderr };
}

function packTarball(temp: string): { path: string; name: string; size: number } {
  const result = run("npm-pack", [
    "npm", "pack", "--ignore-scripts", "--pack-destination", temp, "--json",
  ]);
  const parsed = JSON.parse(result.stdout) as Array<{ filename?: string; size?: number }>;
  assert.equal(parsed.length, 1, "npm pack must produce exactly one tarball");
  const name = parsed[0]!.filename;
  assert.ok(name, "npm pack did not report a filename");
  const path = join(temp, name);
  assert.ok(existsSync(path), `missing packed tarball ${path}`);
  const size = statSync(path).size;
  pass(`tarball ${name} (${(size / 1024).toFixed(1)} KiB)`);
  return { path, name, size };
}

function inspectTarball(tarball: string): Record<string, unknown> {
  const entries = run("tar-list", ["tar", "-tzf", tarball]).stdout.split("\n").filter(Boolean);
  assert.ok(entries.includes("package/dist/node/main.js"), "tarball is missing dist/node/main.js");
  assert.ok(entries.includes("package/package.json"), "tarball is missing package.json");
  for (const prefix of ["package/src/", "package/tests/", "package/docs/", "package/scripts/"]) {
    assert.ok(!entries.some(entry => entry.startsWith(prefix)), `tarball unexpectedly contains ${prefix}`);
  }
  pass(`tarball-contents (${entries.length} entries, dist only)`);

  const packed = JSON.parse(run("tar-package-json", ["tar", "-xOf", tarball, "package/package.json"]).stdout) as {
    main?: string;
    bin?: Record<string, string>;
    files?: string[];
    exports?: Record<string, unknown>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(packed.main, "./dist/node/main.js");
  assert.equal(packed.bin?.atom, "./dist/node/main.js");
  assert.deepEqual(packed.files, ["dist/node/main.js"]);
  assert.ok(packed.exports?.["."], "package.json is missing the root export");

  const runtimeDeps = Object.entries(packed.dependencies ?? {});
  assert.ok(runtimeDeps.length > 0, "tarball has no runtime dependencies");
  for (const [name, spec] of runtimeDeps) {
    assert.ok(!name.startsWith("@atom-neo/"), `workspace package ${name} must not be a runtime dependency`);
    assert.ok(!spec.includes("workspace:"), `runtime dependency ${name} still uses workspace: protocol`);
  }
  for (const required of ["@opentui/core", "@opentui/react", "react"]) {
    assert.ok(required in (packed.dependencies ?? {}), `missing runtime dependency ${required}`);
  }
  const workspaceDevDeps = Object.entries(packed.devDependencies ?? {}).filter(([name]) => name.startsWith("@atom-neo/"));
  assert.ok(workspaceDevDeps.length > 0, "workspace packages should remain build-time devDependencies");
  pass(`tarball-package-json (${runtimeDeps.length} runtime deps, workspace packages dev-only)`);

  const source = run("tar-main", ["tar", "-xOf", tarball, "package/dist/node/main.js"]).stdout;
  assert.match(source.split("\n")[0] ?? "", /^#!\/usr\/bin\/env node$/);
  for (const pattern of [/\bfrom\s*["']bun:/, /\bimport\s*\(\s*["']bun:/, /\brequire\s*\(\s*["']bun:/]) {
    assert.doesNotMatch(source, pattern);
  }
  pass("tarball-main-shebang-and-no-bun-imports");
  return packed;
}

function writeSandbox(sandbox: string): void {
  mkdirSync(join(sandbox, ".atom"), { recursive: true });
  writeFileSync(join(sandbox, "AGENTS.md"), "");
  writeFileSync(join(sandbox, ".atom", "installed"), "");
  writeFileSync(join(sandbox, "config.json"), JSON.stringify({
    version: 2,
    providerProfiles: {
      advanced: "pack-smoke/pack-model",
      balanced: "pack-smoke/pack-model",
      basic: "pack-smoke/pack-model",
    },
    providers: {
      "pack-smoke": {
        protocol: "openai-compatible",
        apiKeyEnv: "ATOM_PACK_SMOKE_KEY",
        models: ["pack-model"],
        baseUrl: "http://127.0.0.1:9/v1",
      },
    },
    conversation: { maxSteps: 1, maxChainDepth: 1 },
    log: { level: "error", ignore: [] },
  }, null, 2));
  writeFileSync(join(sandbox, ".env"), "ATOM_PACK_SMOKE_KEY=sk-pack-smoke\n");
}

async function smokeInstalledCore(project: string, temp: string): Promise<void> {
  const sandbox = join(temp, "sandbox");
  const runtimeFile = join(sandbox, ".atom", "core-runtime.json");
  writeSandbox(sandbox);

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    ATOM_HTTP_RUNTIME: "node",
    ATOM_PACK_SMOKE_KEY: "sk-pack-smoke",
  };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;

  const child = Bun.spawn([
    "node", join(project, "node_modules/atom-neo/dist/node/main.js"),
    "--mode", "core", "--port", "0", "--host", "127.0.0.1", "--sandbox", sandbox,
  ], {
    cwd: project,
    env,
    stdout: "ignore",
    stderr: "pipe",
  });

  try {
    const runtime = await waitFor(() => {
      if (!existsSync(runtimeFile)) return undefined;
      try {
        const parsed = JSON.parse(readFileSync(runtimeFile, "utf8")) as RuntimeFile;
        return parsed.url && parsed.token ? parsed : undefined;
      } catch {
        return undefined;
      }
    }, START_TIMEOUT_MS, "installed core-runtime.json");

    const health = await fetch(`${runtime.url}/api/health`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(health.status, 200);
    const body = await health.json() as { status?: string };
    assert.equal(body.status, "ok");
    pass("installed-core-health");

    child.kill("SIGTERM");
    const exitCode = await Promise.race([
      child.exited,
      sleep(STOP_TIMEOUT_MS).then(() => "timeout" as const),
    ]);
    assert.notEqual(exitCode, "timeout", "installed Core did not exit after SIGTERM");
    assert.equal(exitCode, 0);
    pass("installed-core-sigterm");
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGKILL");
    const stderr = await new Response(child.stderr as ReadableStream<Uint8Array>).text();
    if (stderr.trim()) console.error("--- installed child stderr ---\n" + stderr.trim());
    throw error;
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await child.exited;
    }
  }
}

async function main(): Promise<void> {
  run("build-node", ["bun", "run", "build:node"]);
  assert.ok(existsSync(MAIN), `missing ${MAIN}`);
  pass(`artifact dist/node/main.js (${(statSync(MAIN).size / 1024 / 1024).toFixed(2)} MiB)`);

  const temp = mkdtempSync(join(tmpdir(), "atom-node-package-smoke-"));
  try {
    const tarball = packTarball(temp);
    inspectTarball(tarball.path);

    const project = join(temp, "project");
    mkdirSync(project);
    run("npm-init", ["npm", "init", "-y"], project);
    run("npm-install", [
      "npm", "install", tarball.path, "--ignore-scripts", "--no-audit", "--no-fund",
    ], project);
    const installed = join(project, "node_modules/atom-neo");
    assert.ok(existsSync(join(installed, "dist/node/main.js")), "installed package is missing dist/node/main.js");
    assert.ok(!existsSync(join(project, "node_modules/@atom-neo")), "installed tarball fetched workspace packages");
    pass("npm-install");

    const help = run("installed-main-help", ["node", join(installed, "dist/node/main.js"), "--help"], project);
    assert.match(help.stdout, /USAGE/);
    pass("installed-main-help");

    const binHelp = run("installed-bin-help", ["npx", "--no-install", "atom", "--help"], project);
    assert.match(binHelp.stdout, /USAGE/);
    pass("installed-bin-help");

    await smokeInstalledCore(project, temp);
  } finally {
    rmSync(temp, { recursive: true, force: true });
    pass("cleanup");
  }
}

const watchdog = setTimeout(() => {
  console.error("FAIL process did not exit");
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

main().then(
  () => {
    console.log(`PASS all (${passed} checks)`);
    process.exit(0);
  },
  (error: unknown) => {
    console.error("FAIL", error);
    process.exit(1);
  },
);
