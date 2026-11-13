/**
 * Release artifact smoke for the built Node entrypoint.
 *
 * Starts `dist/node/main.js` (not a source bundle) in core mode with
 * `ATOM_HTTP_RUNTIME=node`, then checks the runtime file, health, TUI attach,
 * a real WebSocket session.ready/ping-pong round-trip and a clean SIGTERM exit.
 *
 * Requires `bun run build:node` first:
 *   bun scripts/node-smoke/release.ts
 */
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WsMessages } from "@atom-neo/shared";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MAIN = join(ROOT, "dist/node/main.js");
const WATCHDOG_MS = 60_000;
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 15_000;
let passed = 0;

type RuntimeFile = { url: string; token: string; instanceId: string };
type Frame = Record<string, unknown>;
type FramePredicate = (frame: Frame) => boolean;

function pass(name: string): void {
  passed++;
  console.log(`PASS ${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function writeSandbox(sandbox: string, temp: string): void {
  mkdirSync(join(sandbox, ".atom"), { recursive: true });
  writeFileSync(join(sandbox, "AGENTS.md"), "");
  writeFileSync(join(sandbox, ".atom", "installed"), "");
  writeFileSync(join(sandbox, "config.json"), JSON.stringify({
    version: 2,
    providerProfiles: {
      advanced: "smoke/smoke-model",
      balanced: "smoke/smoke-model",
      basic: "smoke/smoke-model",
    },
    providers: {
      smoke: {
        protocol: "openai-compatible",
        apiKeyEnv: "ATOM_SMOKE_KEY",
        models: ["smoke-model"],
        baseUrl: "http://127.0.0.1:9/v1",
      },
    },
    conversation: { maxSteps: 1, maxChainDepth: 1 },
    log: { level: "error", ignore: [] },
  }, null, 2));
  writeFileSync(join(sandbox, ".env"), "ATOM_SMOKE_KEY=sk-release-smoke\n");
  writeFileSync(join(temp, "README.md"), "# release smoke temp\n");
}

function frameQueue(socket: WebSocket): (predicate: FramePredicate) => Promise<Frame> {
  const frames: Frame[] = [];
  const waiters: Array<{ predicate: FramePredicate; resolve: (frame: Frame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];

  const dispatch = () => {
    while (waiters.length > 0) {
      const waiter = waiters[0]!;
      const index = frames.findIndex(waiter.predicate);
      if (index < 0) return;
      const [frame] = frames.splice(index, 1);
      clearTimeout(waiter.timer);
      waiters.shift();
      waiter.resolve(frame!);
    }
  };

  socket.addEventListener("message", (event) => {
    try {
      frames.push(JSON.parse(String(event.data)) as Frame);
    } catch {
      return;
    }
    dispatch();
  });

  return (predicate: FramePredicate) => new Promise<Frame>((resolveFrame, reject) => {
    const waiter = {
      predicate,
      resolve: resolveFrame,
      reject,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error("websocket frame timeout"));
      }, 10_000),
    };
    waiters.push(waiter);
    dispatch();
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("websocket open timeout"));
    }, 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolveOpen();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket error"));
    }, { once: true });
  });
}

async function readStream(stream: ReadableStream<Uint8Array> | undefined): Promise<string> {
  return stream ? await new Response(stream).text() : "";
}

async function main(): Promise<void> {
  assert.ok(existsSync(MAIN), `missing ${MAIN}; run \`bun run build:node\` first (smoke:node does this)`);
  assert.ok(statSync(MAIN).size > 0, `${MAIN} is empty`);
  pass(`artifact dist/node/main.js (${(statSync(MAIN).size / 1024 / 1024).toFixed(2)} MiB)`);

  const temp = mkdtempSync(join(tmpdir(), "atom-node-release-smoke-"));
  const sandbox = join(temp, "sandbox");
  const runtimeFile = join(sandbox, ".atom", "core-runtime.json");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let socket: WebSocket | undefined;
  let runtime: RuntimeFile | undefined;

  try {
    writeSandbox(sandbox, temp);
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ATOM_HTTP_RUNTIME: "node",
      ATOM_SMOKE_KEY: "sk-release-smoke",
    };
    if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;

    child = Bun.spawn([
      "node", MAIN,
      "--mode", "core",
      "--port", "0",
      "--host", "127.0.0.1",
      "--sandbox", sandbox,
    ], {
      cwd: temp,
      env,
      stdout: "ignore",
      stderr: "pipe",
    });

    runtime = await waitFor(() => {
      if (!existsSync(runtimeFile)) return undefined;
      try {
        const parsed = JSON.parse(readFileSync(runtimeFile, "utf8")) as RuntimeFile;
        return parsed.url && parsed.token && parsed.instanceId ? parsed : undefined;
      } catch {
        return undefined;
      }
    }, START_TIMEOUT_MS, "core-runtime.json");
    assert.equal(runtime.url, `http://127.0.0.1:${new URL(runtime.url).port}`);
    pass("core-runtime-file");

    const health = await fetch(`${runtime.url}/api/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json() as { status?: string };
    assert.equal(healthBody.status, "ok");
    pass("health");

    const attach = await fetch(`${runtime.url}/api/tui/attach`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-atom-admin-token": runtime.token },
      body: "{}",
    });
    assert.equal(attach.status, 200);
    const attached = await attach.json() as {
      sessionId?: string;
      serverInfo?: { port?: number; host?: string };
    };
    assert.ok(attached.sessionId);
    assert.equal(attached.serverInfo?.port, Number(new URL(runtime.url).port));
    pass("attach");

    socket = new WebSocket(`${runtime.url.replace(/^http/, "ws")}/ws/${encodeURIComponent(attached.sessionId)}`);
    const next = frameQueue(socket);
    await waitForOpen(socket);
    const ready = await next(frame => frame.type === WsMessages.Server.SessionReady);
    assert.equal((ready.payload as { sessionId?: string }).sessionId, attached.sessionId);
    pass("ws-session-ready");

    socket.send(JSON.stringify({ type: WsMessages.Control.Ping, payload: { n: 11 } }));
    await next(frame => frame.type === WsMessages.Control.Pong);
    pass("ws-ping-pong");

    const closed = new Promise<void>((resolveClose) => {
      socket!.addEventListener("close", () => resolveClose(), { once: true });
    });
    socket.close(1000, "release-smoke-done");
    await Promise.race([closed, sleep(2_000)]);
    socket = undefined;

    child.kill("SIGTERM");
    const exitCode = await Promise.race([
      child.exited,
      sleep(STOP_TIMEOUT_MS).then(() => {
        child!.kill("SIGKILL");
        return "timeout" as const;
      }),
    ]);
    assert.notEqual(exitCode, "timeout", "Node Core did not exit after SIGTERM");
    assert.equal(exitCode, 0);
    pass("sigterm-exit-0");
    assert.equal(existsSync(runtimeFile), false, "core-runtime.json was not cleaned up on shutdown");
    pass("runtime-file-cleaned");
  } catch (error) {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    const stderr = child ? await readStream(child.stderr as ReadableStream<Uint8Array> | undefined) : "";
    if (stderr.trim()) console.error("--- child stderr ---\n" + stderr.trim());
    throw error;
  } finally {
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      try { socket.close(1000, "release-smoke-abort"); } catch { /* already closed */ }
    }
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
      await child.exited;
    }
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
