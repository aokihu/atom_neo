/**
 * S10-A Node build smoke.
 *
 * Requires `bun run build:node` first. Checks:
 * 1. `dist/node/main.js` exists.
 * 2. `node dist/node/main.js --help` exits 0.
 * 3. No static Bun imports (`from "bun`, `import("bun:`, `require("bun:`)
 *    remain in the built output.
 * 4. The TUI entrypoints import under Node without executing the Bun-only
 *    `@opentui/react/runtime-plugin-support` module.
 *
 * Uses Node standard APIs only, so it runs under both Node >= 26 and Bun:
 *   node scripts/node-smoke/build.ts
 *   bun run scripts/node-smoke/build.ts
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NODE_OUT = join(ROOT, "dist/node");
const MAIN = join(NODE_OUT, "main.js");
const TUI_PROBE = join(ROOT, "scripts/node-smoke/tui-import.ts");
const MIN_NODE_MAJOR = 26;

const STATIC_BUN_PATTERNS = [
  { label: 'from "bun', pattern: /\bfrom\s*["']bun:/g },
  { label: 'import "bun:', pattern: /\bimport\s*["']bun:/g },
  { label: 'import("bun:', pattern: /\bimport\s*\(\s*["']bun:/g },
  { label: 'require("bun:', pattern: /\brequire\s*\(\s*["']bun:/g },
];

let passed = 0;

function pass(name: string): void {
  passed++;
  console.log(`PASS ${name}`);
}

function run(command: string, args: string[], cwd = ROOT): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function javascriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...javascriptFiles(full));
    else if (/\.(?:js|mjs|cjs)$/.test(entry)) files.push(full);
  }
  return files;
}

function scanBunImports(): { staticMatches: string[]; dynamicBunStrings: string[] } {
  const staticMatches: string[] = [];
  const dynamicBunStrings: string[] = [];
  for (const file of javascriptFiles(NODE_OUT)) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      for (const { label, pattern } of STATIC_BUN_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(line)) staticMatches.push(`${file}:${index + 1} ${label}`);
      }
      if (line.includes("bun:")) dynamicBunStrings.push(`${file}:${index + 1} ${line.trim()}`);
    });
  }
  return { staticMatches, dynamicBunStrings };
}

function main(): void {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  assert.ok(nodeMajor >= MIN_NODE_MAJOR, `Node >= ${MIN_NODE_MAJOR} required, got ${process.versions.node}`);
  pass(`node-version v${process.versions.node}`);

  assert.ok(existsSync(MAIN), `missing ${MAIN}; run \`bun run build:node\` first`);
  const size = statSync(MAIN).size;
  pass(`artifact ${MAIN.slice(ROOT.length + 1)} (${(size / 1024 / 1024).toFixed(2)} MiB)`);

  const help = run("node", [MAIN, "--help"]);
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /USAGE/);
  pass("node-main-help");

  const { staticMatches, dynamicBunStrings } = scanBunImports();
  assert.equal(staticMatches.length, 0, `static bun imports in dist/node:\n${staticMatches.join("\n")}`);
  pass("no-static-bun-imports");
  if (dynamicBunStrings.length > 0) {
    console.log(`INFO dynamic bun: strings (not imported): ${dynamicBunStrings.length}`);
    for (const match of dynamicBunStrings) console.log(`  ${match}`);
  }

  const temp = mkdtempSync(join(NODE_OUT, ".tui-import-"));
  try {
    const build = run("bun", ["build", TUI_PROBE, "--target", "node", "--outdir", temp, "--external", "@opentui/*"]);
    assert.equal(build.status, 0, build.stderr);
    const probe = join(temp, "tui-import.js");
    assert.ok(existsSync(probe), `missing TUI probe bundle ${probe}`);

    const imported = run("node", [probe]);
    assert.equal(imported.status, 0, imported.stderr || imported.stdout);
    assert.match(imported.stdout, /TUI_IMPORT_OK/);
    assert.doesNotMatch(imported.stderr, /runtime-plugin-support/);
    pass("tui-import-on-node");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }

  console.log(`PASS all (${passed} checks)`);
}

try {
  main();
  process.exit(0);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
