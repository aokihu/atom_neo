/**
 * Bun client -> Node Core cross-runtime smoke.
 *
 * Builds `src/main.ts` for Node, starts it with `ATOM_HTTP_RUNTIME=node`, then
 * uses Bun's global fetch/WebSocket to attach and observe `session.ready`.
 *
 * Run from the repository root:
 *   bun scripts/node-smoke/cross-runtime.ts
 */
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WATCHDOG_MS = 60_000;
let passed = 0;

function pass(name: string): void {
  passed++;
  console.log(`PASS ${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor<T>(check: () => Promise<T | undefined>, label: string): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < WATCHDOG_MS) {
    const value = await check();
    if (value !== undefined) return value;
    await sleep(50);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main(): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), "atom-cross-runtime-"));
  const sandbox = join(temp, "sandbox");
  const bundle = join(temp, "main.mjs");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let socket: WebSocket | undefined;

  try {
    const build = Bun.spawnSync([
      "bun", "build", join(ROOT, "src/main.ts"),
      "--target", "node", "--external", "ws",
      "--outfile", bundle,
    ], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    assert.equal(build.exitCode, 0, new TextDecoder().decode(build.stderr));
    pass("node-bundle");

    await mkdir(join(temp, "node_modules"), { recursive: true });
    await symlink(join(ROOT, "src/packages/shared/node_modules/ws"), join(temp, "node_modules/ws"));
    await mkdir(join(sandbox, ".atom"), { recursive: true });
    await writeFile(join(sandbox, "AGENTS.md"), "");
    await writeFile(join(sandbox, ".atom/installed"), "");
    await writeFile(join(sandbox, "config.json"), JSON.stringify({
      version: 2,
      providerProfiles: { advanced: "deepseek/local", balanced: "deepseek/local", basic: "deepseek/local" },
      providers: { deepseek: { apiKeyEnv: "ATOM_CROSS_KEY", models: ["local"] } },
      conversation: { maxSteps: 1, maxChainDepth: 1 },
    }));

    child = Bun.spawn([
      "node", bundle,
      "--mode", "core",
      "--port", "0",
      "--host", "127.0.0.1",
      "--sandbox", sandbox,
    ], {
      cwd: temp,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ATOM_HTTP_RUNTIME: "node",
        ATOM_CROSS_KEY: "local-test-only",
      },
      stdout: "ignore",
      stderr: "pipe",
    });

    const runtimeFile = join(sandbox, ".atom/core-runtime.json");
    const runtime = await waitFor(async () => {
      if (!existsSync(runtimeFile)) return undefined;
      return JSON.parse(await readFile(runtimeFile, "utf8")) as { url: string; token: string };
    }, "Node Core runtime file");
    pass("node-core-start");

    const health = await fetch(`${runtime.url}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { status?: string }).status, "ok");
    pass("health");

    const attach = await fetch(`${runtime.url}/api/tui/attach`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-atom-admin-token": runtime.token },
      body: "{}",
    });
    assert.equal(attach.status, 200);
    const attached = await attach.json() as { sessionId?: string; serverInfo?: { port?: number } };
    assert.ok(attached.sessionId);
    assert.equal(attached.serverInfo?.port, Number(new URL(runtime.url).port));
    pass("attach");

    socket = new WebSocket(`${runtime.url.replace(/^http/, "ws")}/ws/${encodeURIComponent(attached.sessionId)}`);
    const ready = await new Promise<{ type?: string; payload?: { sessionId?: string } }>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error("cross-runtime websocket timeout")), 10_000);
      socket!.onmessage = (event) => {
        const frame = JSON.parse(String(event.data)) as { type?: string; payload?: { sessionId?: string } };
        if (frame.type !== "session.ready") return;
        clearTimeout(timer);
        resolveReady(frame);
      };
      socket!.onerror = () => {
        clearTimeout(timer);
        reject(new Error("cross-runtime websocket error"));
      };
    });
    assert.equal(ready.type, "session.ready");
    assert.equal(ready.payload?.sessionId, attached.sessionId);
    pass("ws-session-ready");

    const closed = new Promise<void>(resolveClose => { socket!.onclose = () => resolveClose(); });
    socket.close(1000, "cross-runtime-done");
    await Promise.race([closed, sleep(2_000)]);
    socket = undefined;

    child.kill("SIGTERM");
    const exitCode = await Promise.race([
      child.exited,
      sleep(10_000).then(() => {
        child!.kill("SIGKILL");
        throw new Error("Node Core did not exit after SIGTERM");
      }),
    ]);
    assert.equal(exitCode, 0);
    pass("node-core-stop");
  } finally {
    if (socket) {
      try { socket.close(1000, "cross-runtime-abort"); } catch { /* already closed */ }
    }
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
      await child.exited;
    }
    await rm(temp, { recursive: true, force: true });
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
