/**
 * Real Node smoke for the full Core runtime.
 *
 * Starts Core from source with the Node HTTP adapter, then checks health,
 * TUI attach, WebSocket session.ready/ping-pong and a clean two-stage stop.
 * S9-D covers transport only; task submission stays in S9-E.
 *
 * Run:
 *   mkdir -p /tmp/atom-node-core-smoke/node_modules
 *   ln -sfn "$PWD/src/packages/shared/node_modules/ws" /tmp/atom-node-core-smoke/node_modules/ws
 *   bun build scripts/node-smoke/core-runtime.ts --target node --external ws \
 *     --outfile /tmp/atom-node-core-smoke/core-runtime.mjs
 *   node /tmp/atom-node-core-smoke/core-runtime.mjs
 */
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { RawData } from "ws";
import { startCore } from "../../src/packages/core/src/server";
import type { CoreServices } from "../../src/packages/core/src/core-services";
import { Logger, WsMessages, createHttpServer, resolveHttpRuntime } from "../../src/packages/shared/src/index";
import { createNodeHttpServer } from "../../src/packages/shared/src/http/node-http-server";

const ADMIN_TOKEN = "node-core-smoke-admin";
let passed = 0;

function pass(name: string): void {
  passed++;
  console.log(`PASS ${name}`);
}

function messageQueue(ws: WebSocket): () => Promise<string> {
  const queue: string[] = [];
  const waiters: Array<(value: string) => void> = [];
  ws.on("message", (raw: RawData, isBinary: boolean) => {
    if (isBinary) return;
    const text = Array.isArray(raw) ? Buffer.concat(raw).toString() : raw.toString();
    const waiter = waiters.shift();
    if (waiter) waiter(text);
    else queue.push(text);
  });
  return () => new Promise<string>((resolve, reject) => {
    if (queue.length > 0) {
      resolve(queue.shift()!);
      return;
    }
    const timer = setTimeout(() => reject(new Error("websocket message timeout")), 5_000);
    waiters.push((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function waitForOpen(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    let status = 0;
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("websocket open timeout"));
    }, 5_000);
    ws.once("upgrade", (response) => {
      status = response.statusCode ?? 0;
    });
    ws.once("open", () => {
      clearTimeout(timer);
      resolve(status);
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket close timeout")), 5_000);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

async function main(): Promise<void> {
  const sandbox = await mkdtemp(join(tmpdir(), "atom-node-core-smoke-"));
  let core: Awaited<ReturnType<typeof startCore>> | undefined;

  try {
    delete process.env.ATOM_HTTP_RUNTIME;
    assert.equal(resolveHttpRuntime(), "node");
    assert.throws(() => resolveHttpRuntime("wat"), /bun.*node/);
    await assert.rejects(() => createHttpServer("bun"), /ATOM_HTTP_RUNTIME=node/);
    pass("runtime-detection");

    const runtime = {
      sandbox,
      maxTokens: 4096,
      appConfig: {
        providers: {},
        conversation: { maxGlobalRounds: 4, maxLocalRounds: 2, maxSteps: 4 },
        decisionMode: { prediction: "jev", postConversation: "jev", continuation: "jev" },
      },
      getResolvedModel() {
        return {
          provider: "local",
          protocol: "deepseek",
          model: "local",
          type: "llm",
          apiKey: "local-test",
          thinking: "disabled",
        };
      },
    };
    const services: CoreServices = {
      memory: {
        search: async () => [],
        getById: () => null,
        save: () => "memory-1",
        traverse: () => [],
        link: () => false,
        forget: () => false,
        retain: () => {},
      },
      network: { webFetch: async () => ({ ok: true, code: "success", content: "" }) },
    };

    core = await startCore({
      port: 0,
      host: "127.0.0.1",
      sandbox,
      logger: new Logger("debug", () => {}),
      runtime,
      services,
      adminToken: ADMIN_TOKEN,
      httpServer: createNodeHttpServer(),
    } as any);
    assert.ok(core.port > 0);
    pass("core-start");

    const base = `http://127.0.0.1:${core.port}`;
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json() as { status?: string };
    assert.equal(healthBody.status, "ok");
    pass("health");

    const attach = await fetch(`${base}/api/tui/attach`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-atom-admin-token": ADMIN_TOKEN },
      body: "{}",
    });
    assert.equal(attach.status, 200);
    const attached = await attach.json() as {
      sessionId?: string;
      serverInfo?: { port?: number; host?: string };
    };
    assert.ok(attached.sessionId);
    assert.equal(attached.serverInfo?.port, core.port);
    pass("attach");

    const ws = new WebSocket(`ws://127.0.0.1:${core.port}/ws/${attached.sessionId}`);
    const next = messageQueue(ws);
    assert.equal(await waitForOpen(ws), 101);
    const ready = JSON.parse(await next()) as { type: string; payload?: { sessionId?: string } };
    assert.equal(ready.type, "session.ready");
    assert.equal(ready.payload?.sessionId, attached.sessionId);
    pass("ws-ready");

    ws.send(JSON.stringify({ type: WsMessages.Control.Ping, payload: { n: 9 } }));
    const pong = JSON.parse(await next()) as { type: string };
    assert.equal(pong.type, WsMessages.Control.Pong);
    pass("ws-ping-pong");

    const closed = waitForClose(ws);
    ws.close(1000, "core-smoke-done");
    assert.equal((await closed).code, 1000);
    pass("ws-close");
  } finally {
    try {
      if (core) {
        await core.stop();
        pass("core-stop");
      }
    } finally {
      await rm(sandbox, { recursive: true, force: true });
      pass("cleanup");
    }
  }
}

const watchdog = setTimeout(() => {
  console.error("FAIL process did not exit");
  process.exit(1);
}, 15_000);
watchdog.unref();

main().then(
  () => {
    console.log(`PASS all (${passed} checks)`);
  },
  (error: unknown) => {
    console.error("FAIL", error);
    process.exit(1);
  },
);
