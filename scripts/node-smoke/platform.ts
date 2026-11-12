/**
 * Real Node smoke for the S10 platform capabilities.
 *
 * Covers config/env loading, MemoryService FTS5, background shell, the glob
 * tool and ScheduleService persistence/restore. No network, external model or
 * TUI is used.
 *
 * Bundle with Bun and run under Node >= 26:
 *   bun build scripts/node-smoke/platform.ts --target node \
 *     --outfile /tmp/atom-node-platform-smoke/platform.mjs
 *   node /tmp/atom-node-platform-smoke/platform.mjs
 */
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Logger } from "@atom-neo/shared";
import { loadConfig } from "../../src/bootstrap/config";
import { loadEnv } from "../../src/bootstrap/env";
import { MemoryService } from "../../src/services/memory/memory-service";
import { BackgroundShellService } from "../../src/packages/core/src/tools/builtin/shell";
import type { BackgroundShellCompletion } from "../../src/packages/core/src/tools/builtin/shell";
import { createGlobTool, createSandbox } from "../../src/packages/core/src/tools/builtin/fs";
import { ScheduleService } from "../../src/packages/core/src/tools/schedule-service";
import { TaskQueue } from "../../src/packages/core/src/task-queue";

const WATCHDOG_MS = 45_000;
const SHELL_TIMEOUT_MS = 15_000;
let passed = 0;

function pass(name: string): void {
  passed++;
  console.log(`PASS ${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function checkConfigAndEnv(root: string): void {
  const savedKey = process.env.ATOM_NODE_SMOKE_KEY;
  const savedPort = process.env.CORE_PORT;
  const configSandbox = join(root, "config");
  try {
    mkdirSync(join(configSandbox, ".atom"), { recursive: true });
    writeFileSync(join(configSandbox, "config.json"), JSON.stringify({
      version: 2,
      providerProfiles: {
        advanced: "local/review-model",
        balanced: "local/review-model",
        basic: "local/review-model",
      },
      providers: {
        local: {
          protocol: "openai-compatible",
          apiKeyEnv: "ATOM_NODE_SMOKE_KEY",
          models: ["review-model", "review-model-fast"],
          baseUrl: "http://127.0.0.1:9/v1",
        },
      },
      conversation: { maxSteps: 7, maxChainDepth: 3 },
      tui: { theme: "edex" },
    }, null, 2));
    writeFileSync(join(configSandbox, ".env"), [
      "export ATOM_NODE_SMOKE_KEY=sk-platform-smoke",
      "CORE_PORT=3999",
      "",
    ].join("\n"));
    writeFileSync(join(configSandbox, ".atom", "runtime-config.json"), JSON.stringify({
      conversation: { maxSteps: 9 },
    }, null, 2));

    delete process.env.ATOM_NODE_SMOKE_KEY;
    delete process.env.CORE_PORT;
    loadEnv(configSandbox);
    assert.equal(process.env.ATOM_NODE_SMOKE_KEY, "sk-platform-smoke");
    assert.equal(process.env.CORE_PORT, "3999");
    pass("config-env-loading");

    const loaded = loadConfig(configSandbox);
    assert.equal(loaded.effective.providerProfiles.advanced, "local/review-model");
    assert.equal(loaded.effective.providers.local.protocol, "openai-compatible");
    assert.deepEqual(loaded.effective.providers.local.models, ["review-model", "review-model-fast"]);
    assert.equal(loaded.effective.conversation.maxSteps, 9);
    assert.equal(loaded.effective.conversation.maxGlobalRounds, 4);
    assert.equal(loaded.userConfig.conversation.maxSteps, 7);
    assert.equal(loaded.runtimeConfig.conversation?.maxSteps, 9);
    pass("config-effective-and-overlay");

    const defaultsSandbox = join(root, "config-defaults");
    const defaults = loadConfig(defaultsSandbox);
    assert.ok(existsSync(join(defaultsSandbox, "config.json")));
    assert.equal(defaults.effective.providerProfiles.balanced, "deepseek/deepseek-v4-flash");
    assert.equal(defaults.userConfig.version, 2);
    pass("config-defaults-created");
  } finally {
    if (savedKey === undefined) delete process.env.ATOM_NODE_SMOKE_KEY;
    else process.env.ATOM_NODE_SMOKE_KEY = savedKey;
    if (savedPort === undefined) delete process.env.CORE_PORT;
    else process.env.CORE_PORT = savedPort;
  }
}

async function checkMemory(root: string): Promise<void> {
  const dbPath = join(root, "memory", "memory.db");
  const memory = new MemoryService({ dbPath });
  let first = "";
  try {
    await memory.start();
    first = memory.save(
      "SQLite full text search powers memory retrieval across sessions.",
      ["sqlite", "fts5", "retrieval"],
    );
    const second = memory.save(
      "Background shell jobs stream stdout and stderr safely.",
      ["shell", "process"],
    );
    assert.notEqual(first, second);

    const hits = await memory.search("memory retrieval", 3);
    assert.ok(hits.some(node => node.id === first), "FTS search did not return the SQLite node");
    assert.ok(!hits.some(node => node.id === second), "FTS search returned an unrelated node");

    const shellHits = await memory.search("shell stdout", 3);
    assert.ok(shellHits.some(node => node.id === second), "FTS search did not return the shell node");
    pass("memory-fts5-search");

    assert.ok(existsSync(dbPath), "memory database was not created");
    pass("memory-sqlite-file");
  } finally {
    await memory.stop();
  }
  assert.throws(() => memory.has(first), /not started/);
  pass("memory-stop");
}

async function checkShell(root: string): Promise<void> {
  let resolveCompletion: (result: BackgroundShellCompletion) => void = () => {};
  const completion = new Promise<BackgroundShellCompletion>((resolve) => {
    resolveCompletion = resolve;
  });
  const shells = new BackgroundShellService({
    sandbox: join(root, "shell"),
    onComplete: (result) => resolveCompletion(result),
  });

  try {
    const job = shells.start("printf 'atom-node-shell-ok\\n'", {
      sessionId: "platform-smoke",
      chatId: "platform-smoke",
      parentTaskId: "platform-smoke",
    });
    assert.ok(job.jobId.startsWith("shell-job-"));
    assert.ok(job.pid > 0);

    const result = await withTimeout(completion, SHELL_TIMEOUT_MS, "background shell");
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /atom-node-shell-ok/);
    assert.equal(result.stderr, "");
    pass("shell-background-output");
  } finally {
    await shells.stop();
  }
  pass("shell-stop");
}

async function checkGlob(root: string): Promise<void> {
  const globRoot = join(root, "glob");
  mkdirSync(join(globRoot, "src", "nested"), { recursive: true });
  writeFileSync(join(globRoot, "src", "alpha.ts"), "export const alpha = 1;\n");
  writeFileSync(join(globRoot, "src", "nested", "beta.ts"), "export const beta = 2;\n");
  writeFileSync(join(globRoot, "README.md"), "# glob smoke\n");

  const tool = createGlobTool(createSandbox(globRoot));
  const result = await tool.execute({ pattern: "**/*.ts", path: "." });
  assert.equal(result.metadata.ok, true);
  const output = String(result.content ?? "");
  assert.match(output, /^src\/alpha\.ts$/m);
  assert.match(output, /^src\/nested\/beta\.ts$/m);
  assert.doesNotMatch(output, /README\.md/);
  pass("glob-tool-matches");

  const scoped = await tool.execute({ pattern: "*.ts", path: "src" });
  assert.equal(scoped.metadata.ok, true);
  assert.match(String(scoped.content ?? ""), /^src\/alpha\.ts$/m);
  assert.doesNotMatch(String(scoped.content ?? ""), /beta\.ts/);
  pass("glob-tool-path-scope");
}

function checkSchedule(root: string): void {
  const persistPath = join(root, "schedule", "tasks.json");
  mkdirSync(dirname(persistPath), { recursive: true });
  const queue = new TaskQueue();
  const logger = new Logger("error", () => {});
  const schedule = new ScheduleService(queue, persistPath, logger);
  const restored = new ScheduleService(queue, persistPath, logger);

  try {
    const delayed = schedule.create({
      name: "platform-delay",
      type: "delay",
      delayMs: 3_600_000,
      sessionId: "platform-smoke",
      chatId: "platform-smoke",
      prompt: "delayed smoke prompt",
    });
    const cron = schedule.create({
      name: "platform-cron",
      type: "cron",
      schedule: "*/5 * * * *",
      sessionId: "platform-smoke",
      chatId: "platform-smoke",
      prompt: "cron smoke prompt",
    });
    assert.equal(schedule.list().length, 2);
    assert.equal(schedule.get(delayed.id)?.type, "delay");
    assert.ok(delayed.nextFireAt !== undefined && delayed.nextFireAt > Date.now());
    assert.ok(cron.nextFireAt !== undefined && cron.nextFireAt > Date.now());
    pass("schedule-create-list");

    const persisted = JSON.parse(readFileSync(persistPath, "utf8")) as Array<{ id: string; name: string; type: string }>;
    assert.equal(persisted.length, 2);
    assert.deepEqual(persisted.map(task => task.id).sort(), [delayed.id, cron.id].sort());
    pass("schedule-persist");

    restored.restore();
    assert.equal(restored.list().length, 2);
    assert.equal(restored.get(delayed.id)?.prompt, "delayed smoke prompt");
    assert.equal(restored.get(cron.id)?.schedule, "*/5 * * * *");
    assert.deepEqual(restored.list().map(task => task.type).sort(), ["cron", "delay"]);
    pass("schedule-restore");
  } finally {
    restored.stop();
    schedule.stop();
  }
  assert.equal(schedule.list().length, 2);
  pass("schedule-stop");
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "atom-node-platform-smoke-"));
  try {
    checkConfigAndEnv(root);
    await checkMemory(root);
    await checkShell(root);
    await checkGlob(root);
    checkSchedule(root);
  } finally {
    await sleep(10);
    rmSync(root, { recursive: true, force: true });
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
