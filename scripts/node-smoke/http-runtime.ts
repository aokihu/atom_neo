/**
 * Real Node smoke for the `node:http` + `ws` adapter.
 *
 * `ws` is externalized and resolved from the workspace dependency; run:
 *   mkdir -p /tmp/atom-node-http-smoke/node_modules
 *   ln -sfn "$PWD/src/packages/shared/node_modules/ws" /tmp/atom-node-http-smoke/node_modules/ws
 *   bun build scripts/node-smoke/http-runtime.ts --target node --external ws \
 *     --outfile /tmp/atom-node-http-smoke/http-runtime.mjs
 *   node /tmp/atom-node-http-smoke/http-runtime.mjs
 */
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { WebSocket } from "ws";
import type { RawData } from "ws";
import { createNodeHttpServer } from "../../src/packages/shared/src/http/node-http-server";
import { isAdminRequest } from "../../src/packages/shared/src/utils/admin-auth";

const ADMIN_TOKEN = "node-smoke-admin";
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
  const handle = await createNodeHttpServer().serve({
    port: 0,
    host: "127.0.0.1",
    async fetch(req, ctx) {
      const url = new URL(req.url);
      if (url.pathname === "/api/health") {
        return Response.json({ status: "ok", runtime: ctx.runtime, ip: ctx.ip, port: ctx.port });
      }
      if (url.pathname === "/api/echo" && req.method === "POST") {
        return Response.json({ received: await req.json() });
      }
      if (url.pathname === "/api/admin") {
        return isAdminRequest(req, ctx, ADMIN_TOKEN)
          ? Response.json({ ok: true })
          : Response.json({ error: "Forbidden" }, { status: 403 });
      }
      return new Response("Not Found", { status: 404 });
    },
    upgrade(req) {
      const url = new URL(req.url);
      if (!url.pathname.startsWith("/ws/")) return undefined;
      const sessionId = decodeURIComponent(url.pathname.slice("/ws/".length));
      if (!sessionId) return { response: Response.json({ error: "Invalid session ID" }, { status: 400 }) };
      return { data: { sessionId } };
    },
    websocket: {
      open(peer) {
        peer.send(JSON.stringify({ type: "session.ready", payload: { sessionId: peer.data.sessionId } }));
      },
      message(peer, data) {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        const frame = JSON.parse(text) as { type?: string; payload?: { n?: number } };
        if (frame.type === "control.ping") {
          peer.send(JSON.stringify({ type: "control.pong", payload: frame.payload ?? {} }));
        }
      },
    },
  });

  try {
    assert.equal(handle.runtime, "node");
    assert.ok(handle.port > 0);
    const base = `http://127.0.0.1:${handle.port}`;

    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json() as { status: string; runtime: string; ip: string; port: number };
    assert.equal(healthBody.status, "ok");
    assert.equal(healthBody.runtime, "node");
    assert.equal(healthBody.port, handle.port);
    assert.ok(healthBody.ip.includes("127.0.0.1"));
    pass("health");

    const echo = await fetch(`${base}/api/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "node" }),
    });
    assert.equal(echo.status, 200);
    assert.deepEqual(await echo.json(), { received: { hello: "node" } });
    pass("post-json");

    assert.equal((await fetch(`${base}/api/admin`, { headers: { "x-atom-admin-token": ADMIN_TOKEN } })).status, 200);
    assert.equal((await fetch(`${base}/api/admin`, { headers: { "x-atom-admin-token": "wrong" } })).status, 403);
    assert.equal((await fetch(`${base}/api/admin`)).status, 403);
    pass("admin-loopback");

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws/smoke-session`);
    const next = messageQueue(ws);
    assert.equal(await waitForOpen(ws), 101);
    const ready = JSON.parse(await next()) as { type: string; payload?: { sessionId?: string } };
    assert.equal(ready.type, "session.ready");
    assert.equal(ready.payload?.sessionId, "smoke-session");
    pass("ws-ready");

    ws.send(JSON.stringify({ type: "control.ping", payload: { n: 7 } }));
    const pong = JSON.parse(await next()) as { type: string; payload?: { n?: number } };
    assert.equal(pong.type, "control.pong");
    assert.equal(pong.payload?.n, 7);
    pass("ws-ping-pong");

    const firstClosed = waitForClose(ws);
    ws.close(1000, "smoke-done");
    assert.equal((await firstClosed).code, 1000);
    pass("ws-close");

    const active = new WebSocket(`ws://127.0.0.1:${handle.port}/ws/active-session`);
    const activeNext = messageQueue(active);
    assert.equal(await waitForOpen(active), 101);
    assert.equal((JSON.parse(await activeNext()) as { type: string }).type, "session.ready");

    const startedAt = Date.now();
    await handle.stop(false);
    assert.ok(Date.now() - startedAt < 2_000);
    pass("stop-graceful-with-active-ws");

    const forcedClosed = waitForClose(active);
    await handle.stop(true);
    const forcedClose = await forcedClosed;
    assert.equal(forcedClose.code, 1001);
    assert.equal(forcedClose.reason, "server shutdown");
    await handle.stop(true);
    await handle.stop(false);
    pass("stop-force-closes-ws");

    let refused = false;
    try {
      await fetch(`${base}/api/health`);
    } catch {
      refused = true;
    }
    assert.equal(refused, true);
    pass("stop-refuses-connections");
  } finally {
    await handle.stop(true);
  }
}

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
