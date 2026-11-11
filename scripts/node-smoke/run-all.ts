/**
 * Node smoke orchestrator (S10-B1).
 *
 * Runs the build boundary check, the platform capabilities smoke and the release
 * artifact smoke, all under Node >= 26. The conversation smoke reuses the S9
 * fake-model script.
 *
 * Usage:
 *   bun scripts/node-smoke/run-all.ts          # build:node + build check + platform + release + conversation
 *   bun scripts/node-smoke/run-all.ts platform # platform only
 *   bun scripts/node-smoke/run-all.ts release  # build:node + release artifact only
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PLATFORM = join(ROOT, "scripts/node-smoke/platform.ts");
const CONVERSATION = join(ROOT, "scripts/node-smoke/core-conversation.ts");
const RELEASE = join(ROOT, "scripts/node-smoke/release.ts");
const BUILD_CHECK = join(ROOT, "scripts/node-smoke/build.ts");
const WATCHDOG_MS = 240_000;

let steps = 0;

function pass(name: string): void {
  steps++;
  console.log(`PASS ${name}`);
}

function run(label: string, command: string[]): void {
  console.log(`\n[smoke:node] ${label}: ${command.join(" ")}`);
  const result = Bun.spawnSync(command, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${label} failed (exit ${result.exitCode})`);
  pass(label);
}

/** Bundles one smoke for Node, then runs it under Node. */
function runNodeBundle(label: string, entry: string, outfile: string, externalWs = false): void {
  const command = ["bun", "build", entry, "--target", "node"];
  if (externalWs) command.push("--external", "ws");
  command.push("--outfile", outfile);
  run(`${label}-bundle`, command);
  if (externalWs) {
    // Node resolves the externalized `ws` from the bundle directory.
    mkdirSync(join(dirname(outfile), "node_modules"), { recursive: true });
    symlinkSync(join(ROOT, "src/packages/shared/node_modules/ws"), join(dirname(outfile), "node_modules/ws"));
  }
  run(label, ["node", outfile]);
}

function main(): void {
  const mode = process.argv[2] ?? "all";
  if (mode !== "all" && mode !== "platform" && mode !== "release") {
    throw new Error(`unknown smoke mode "${mode}" (expected all | platform | release)`);
  }

  const temp = mkdtempSync(join(tmpdir(), "atom-node-smoke-bundles-"));
  try {
    if (mode === "all" || mode === "release") {
      run("build-node", ["bun", "run", "build:node"]);
    }
    if (mode === "all") {
      run("build-check", ["bun", BUILD_CHECK]);
    }

    if (mode === "all" || mode === "platform") {
      runNodeBundle("platform", PLATFORM, join(temp, "platform.mjs"));
    }

    if (mode === "all" || mode === "release") {
      run("release-artifact", ["bun", RELEASE]);
    }

    if (mode === "all") {
      runNodeBundle("conversation", CONVERSATION, join(temp, "core-conversation.mjs"), true);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }

  console.log(`\nPASS smoke:node (${mode}, ${steps} steps)`);
}

const watchdog = setTimeout(() => {
  console.error("FAIL process did not exit");
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

try {
  main();
  process.exit(0);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
