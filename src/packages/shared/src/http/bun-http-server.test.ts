/**
 * Contract tests for the Bun `HttpServer` adapter: port reporting, HTTP fetch,
 * upgrade decisions and the two-stage stop.
 */
import { expect, test } from "bun:test";
import { createBunHttpServer } from "./bun-http-server";
import type { HttpServerOptions } from "./types";

type TestData = { sessionId: string };

function testOptions(overrides: Partial<HttpServerOptions<TestData>> = {}): HttpServerOptions<TestData> {
  return {
    port: 0,
    host: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/health") return Response.json({ ok: true });
      return new Response("Not Found", { status: 404 });
    },
    upgrade(req) {
      const path = new URL(req.url).pathname;
      if (!path.startsWith("/ws/")) return undefined;
      const sessionId = path.slice("/ws/".length);
      if (!sessionId) return { response: Response.json({ error: "Invalid session ID" }, { status: 400 }) };
      return { data: { sessionId } };
    },
    websocket: {
      open(peer) {
        peer.send(JSON.stringify({ type: "session.ready", sessionId: peer.data.sessionId }));
      },
    },
    ...overrides,
  };
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket open timeout")), 2_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket failed before open"));
    }, { once: true });
  });
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket message timeout")), 2_000);
    ws.addEventListener("message", (event) => {
      clearTimeout(timer);
      const data = event.data;
      resolve(typeof data === "string" ? data : new TextDecoder().decode(data));
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket error while waiting for message"));
    }, { once: true });
  });
}

function waitForClose(ws: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket close timeout")), 2_000);
    ws.addEventListener("close", (event) => {
      clearTimeout(timer);
      resolve(event);
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket error while waiting for close"));
    }, { once: true });
  });
}

test("port 0 reports the real listening port and builds the request context", async () => {
  const handle = await createBunHttpServer().serve(testOptions({
    async fetch(req, ctx) {
      if (new URL(req.url).pathname !== "/health") return new Response("Not Found", { status: 404 });
      return Response.json({ runtime: ctx.runtime, ip: ctx.ip, port: ctx.port });
    },
  }));
  try {
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.runtime).toBe("bun");
    const response = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(response.status).toBe(200);
    const body = await response.json() as { runtime: string; ip: string; port: number };
    expect(body.runtime).toBe("bun");
    expect(body.port).toBe(handle.port);
    expect(body.ip.length).toBeGreaterThan(0);
  } finally {
    await handle.stop(true);
  }
});

test("fetch returns route responses unchanged", async () => {
  const handle = await createBunHttpServer().serve(testOptions());
  try {
    const ok = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });

    const missing = await fetch(`http://127.0.0.1:${handle.port}/missing`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Not Found");
  } finally {
    await handle.stop(true);
  }
});

test("upgrade decisions map to 101, 400 and 426", async () => {
  const handle = await createBunHttpServer().serve(testOptions());
  try {
    const base = `http://127.0.0.1:${handle.port}`;

    const invalid = await fetch(`${base}/ws/`);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Invalid session ID" });

    const noUpgrade = await fetch(`${base}/ws/session-1`);
    expect(noUpgrade.status).toBe(426);
    expect(await noUpgrade.text()).toBe("Upgrade Required");

    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws/session-1`);
    const message = nextMessage(ws);
    await waitForOpen(ws);
    expect(JSON.parse(await message)).toEqual({ type: "session.ready", sessionId: "session-1" });
    const closed = waitForClose(ws);
    ws.close();
    await closed;
  } finally {
    await handle.stop(true);
  }
});

test("stop(false) rejects new connections and resolves with an active WebSocket", async () => {
  const handle = await createBunHttpServer().serve(testOptions());
  const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws/session-1`);
  const message = nextMessage(ws);
  await waitForOpen(ws);
  await message;
  try {
    const closed = waitForClose(ws);
    await handle.stop(false);
    let refused = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await fetch(`http://127.0.0.1:${handle.port}/health`);
        await Bun.sleep(5);
      } catch {
        refused = true;
        break;
      }
    }
    expect(refused).toBe(true);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    await handle.stop(true);
    await closed;
  } finally {
    ws.close();
    await handle.stop(true);
  }
});

test("stop(true) closes active WebSocket clients and is idempotent", async () => {
  const handle = await createBunHttpServer().serve(testOptions());
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws/session-1`);
    const message = nextMessage(ws);
    await waitForOpen(ws);
    await message;

    const closed = waitForClose(ws);
    await handle.stop(true);
    await closed;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    await handle.stop(true);
    await handle.stop(false);
  } finally {
    await handle.stop(true);
  }
});
