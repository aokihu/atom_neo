/**
 * Contract tests for the Node `HttpServer` adapter: HTTP body bridging,
 * upgrade decisions, `ws` peer normalization, admin IP handling and stop.
 * Runs under `bun:test`; the Node smoke covers the real Node runtime.
 */
import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { connect } from "node:net";
import { Buffer } from "node:buffer";
import { WebSocket } from "ws";
import type { WebSocket as WsSocket } from "ws";
import { createNodeHttpServer } from "./node-http-server";
import { attachPeerHandlers, normalizeMessage } from "./node-websocket-peer";
import { isAdminRequest } from "../utils/admin-auth";
import type { HttpServerOptions, WebSocketPeer } from "./types";

type TestData = { sessionId: string };

function testOptions(overrides: Partial<HttpServerOptions<TestData>> = {}): HttpServerOptions<TestData> {
  return {
    port: 0,
    host: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path.startsWith("/ws/")) return new Response("Upgrade Required", { status: 426 });
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

function openWebSocket(url: string): Promise<{ ws: WsSocket; status: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let status = 0;
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("websocket open timeout"));
    }, 3_000);
    ws.once("upgrade", (response) => {
      status = response.statusCode ?? 0;
    });
    ws.once("open", () => {
      clearTimeout(timer);
      resolve({ ws, status });
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function messageQueue(ws: WsSocket): () => Promise<string> {
  const queue: string[] = [];
  const waiters: Array<(value: string) => void> = [];
  ws.on("message", (raw, isBinary) => {
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
    const timer = setTimeout(() => reject(new Error("websocket message timeout")), 3_000);
    waiters.push((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function waitForClose(ws: WsSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket close timeout")), 3_000);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

async function waitUntil(check: () => boolean, label: string): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 3_000) throw new Error(`${label} timeout`);
    await Bun.sleep(5);
  }
}

function rawRequest(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw request timeout"));
    }, 3_000);
    socket.on("connect", () => socket.write(request));
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString());
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

type RawResponse = { status: number; headers: string; body: string };

function decodeChunked(body: string): string {
  let offset = 0;
  let decoded = "";
  while (offset < body.length) {
    const lineEnd = body.indexOf("\r\n", offset);
    if (lineEnd < 0) break;
    const size = Number.parseInt(body.slice(offset, lineEnd), 16);
    if (!Number.isFinite(size) || size === 0) break;
    const start = lineEnd + 2;
    decoded += body.slice(start, start + size);
    offset = start + size + 2;
  }
  return decoded;
}

function parseRawResponse(raw: string): RawResponse {
  const separator = raw.indexOf("\r\n\r\n");
  const headers = separator < 0 ? raw : raw.slice(0, separator);
  const body = separator < 0 ? "" : raw.slice(separator + 4);
  return {
    status: Number(headers.split(" ")[1]),
    headers,
    body: /transfer-encoding:\s*chunked/i.test(headers) ? decodeChunked(body) : body,
  };
}

function rawUpgrade(port: number, path: string): Promise<RawResponse> {
  return rawRequest(port, [
    `GET ${path} HTTP/1.1`,
    `host: 127.0.0.1:${port}`,
    "connection: Upgrade",
    "upgrade: websocket",
    "sec-websocket-version: 13",
    "sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==",
    "",
    "",
  ].join("\r\n")).then(parseRawResponse);
}

test("port 0 reports the real listening port and builds the request context", async () => {
  const handle = await createNodeHttpServer().serve(testOptions({
    async fetch(req, ctx) {
      if (new URL(req.url).pathname !== "/health") return new Response("Not Found", { status: 404 });
      return Response.json({ runtime: ctx.runtime, ip: ctx.ip, port: ctx.port });
    },
  }));
  try {
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.runtime).toBe("node");
    const response = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(response.status).toBe(200);
    const body = await response.json() as { runtime: string; ip: string; port: number };
    expect(body.runtime).toBe("node");
    expect(body.port).toBe(handle.port);
    expect(body.ip).toContain("127.0.0.1");
  } finally {
    await handle.stop(true);
  }
});

test("fetch returns route responses unchanged and maps handler errors to 500", async () => {
  const handle = await createNodeHttpServer().serve(testOptions({
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/health") return Response.json({ ok: true });
      if (path === "/boom") throw new Error("boom");
      return new Response("Not Found", { status: 404 });
    },
  }));
  try {
    const ok = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });

    const missing = await fetch(`http://127.0.0.1:${handle.port}/missing`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Not Found");

    const failed = await fetch(`http://127.0.0.1:${handle.port}/boom`);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Internal error" });
  } finally {
    await handle.stop(true);
  }
});

test("POST bodies bridge through Readable.toWeb, including chunked and empty bodies", async () => {
  const handle = await createNodeHttpServer().serve(testOptions({
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/echo") return Response.json({ received: await req.json() });
      if (path === "/text") return Response.json({ length: (await req.text()).length });
      return new Response("Not Found", { status: 404 });
    },
  }));
  try {
    const base = `http://127.0.0.1:${handle.port}`;
    const echo = await fetch(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "node" }),
    });
    expect(echo.status).toBe(200);
    expect(await echo.json()).toEqual({ received: { hello: "node" } });

    const chunk = Buffer.from(JSON.stringify({ chunked: true }));
    const raw = await rawRequest(handle.port, [
      "POST /echo HTTP/1.1",
      `host: 127.0.0.1:${handle.port}`,
      "content-type: application/json",
      "transfer-encoding: chunked",
      "connection: close",
      "",
      chunk.length.toString(16),
      chunk.toString(),
      "0",
      "",
      "",
    ].join("\r\n"));
    const parsed = parseRawResponse(raw);
    expect(parsed.status).toBe(200);
    expect(JSON.parse(parsed.body)).toEqual({ received: { chunked: true } });

    const empty = await fetch(`${base}/text`, { method: "POST" });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ length: 0 });
  } finally {
    await handle.stop(true);
  }
});

test("204, 304 and HEAD responses carry no body", async () => {
  const handle = await createNodeHttpServer().serve(testOptions({
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/no-content") return new Response(null, { status: 204 });
      if (path === "/not-modified") return new Response(null, { status: 304 });
      if (path === "/head") {
        return new Response(JSON.stringify({ hidden: true }), {
          headers: { "content-type": "application/json", "x-test": "head" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  }));
  try {
    const base = `http://127.0.0.1:${handle.port}/`;

    const noContent = parseRawResponse(await rawRequest(handle.port, `GET /no-content HTTP/1.1\r\nhost: 127.0.0.1:${handle.port}\r\nconnection: close\r\n\r\n`));
    expect(noContent.status).toBe(204);
    expect(noContent.body).toBe("");

    const notModified = parseRawResponse(await rawRequest(handle.port, `GET /not-modified HTTP/1.1\r\nhost: 127.0.0.1:${handle.port}\r\nconnection: close\r\n\r\n`));
    expect(notModified.status).toBe(304);
    expect(notModified.body).toBe("");

    const head = parseRawResponse(await rawRequest(handle.port, `HEAD /head HTTP/1.1\r\nhost: 127.0.0.1:${handle.port}\r\nconnection: close\r\n\r\n`));
    expect(head.status).toBe(200);
    expect(head.headers).toContain("x-test: head");
    expect(head.body).toBe("");

    expect((await fetch(`${base}no-content`)).status).toBe(204);
    expect((await fetch(`${base}not-modified`)).status).toBe(304);
  } finally {
    await handle.stop(true);
  }
});

test("multiple Set-Cookie headers survive the response bridge", async () => {
  const handle = await createNodeHttpServer().serve(testOptions({
    async fetch() {
      return new Response("ok", {
        headers: [["set-cookie", "first=1"], ["set-cookie", "second=2"]],
      });
    },
  }));
  try {
    const response = await fetch(`http://127.0.0.1:${handle.port}/cookies`);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual(["first=1", "second=2"]);
    expect(await response.text()).toBe("ok");
  } finally {
    await handle.stop(true);
  }
});

test("upgrade decisions map to 101, 400, 426 and 404", async () => {
  const handle = await createNodeHttpServer().serve(testOptions());
  try {
    const base = `http://127.0.0.1:${handle.port}`;

    const { ws, status } = await openWebSocket(`ws://127.0.0.1:${handle.port}/ws/session-1`);
    const next = messageQueue(ws);
    expect(status).toBe(101);
    expect(JSON.parse(await next())).toEqual({ type: "session.ready", sessionId: "session-1" });
    const closed = waitForClose(ws);
    ws.close(1000, "test-done");
    await closed;

    const invalid = await rawUpgrade(handle.port, "/ws/");
    expect(invalid.status).toBe(400);
    expect(JSON.parse(invalid.body)).toEqual({ error: "Invalid session ID" });

    const noUpgrade = await fetch(`${base}/ws/session-1`);
    expect(noUpgrade.status).toBe(426);
    expect(await noUpgrade.text()).toBe("Upgrade Required");

    const missing = await rawUpgrade(handle.port, "/other");
    expect(missing.status).toBe(404);
    expect(missing.body).toBe("Not Found");
  } finally {
    await handle.stop(true);
  }
});

test("upgrade data without a websocket handler returns raw 426", async () => {
  const handle = await createNodeHttpServer().serve(testOptions({ websocket: undefined }));
  try {
    const response = await rawUpgrade(handle.port, "/ws/session-1");
    expect(response.status).toBe(426);
    expect(response.body).toBe("Upgrade Required");
  } finally {
    await handle.stop(true);
  }
});

test("text and binary frames are normalized and keep one peer per socket", async () => {
  const received: Array<string | Uint8Array> = [];
  const peers = new Set<WebSocketPeer<TestData>>();
  let closeCalls = 0;

  const handle = await createNodeHttpServer().serve(testOptions({
    websocket: {
      open(peer) {
        peers.add(peer);
        peer.send(JSON.stringify({ type: "ready" }));
      },
      message(peer, data) {
        peers.add(peer);
        received.push(data);
        peer.send(JSON.stringify(typeof data === "string"
          ? { kind: "text", value: data }
          : { kind: "binary", value: [...data] }));
      },
      close(peer) {
        peers.add(peer);
        closeCalls++;
      },
    },
  }));
  try {
    const { ws } = await openWebSocket(`ws://127.0.0.1:${handle.port}/ws/session-1`);
    const next = messageQueue(ws);
    expect(JSON.parse(await next())).toEqual({ type: "ready" });

    ws.send("hello");
    expect(JSON.parse(await next())).toEqual({ kind: "text", value: "hello" });
    expect(typeof received[0]).toBe("string");

    ws.send(Buffer.from([1, 2, 3]));
    expect(JSON.parse(await next())).toEqual({ kind: "binary", value: [1, 2, 3] });
    expect(received[1]).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(received[1])).toBe(false);

    const closed = waitForClose(ws);
    ws.close(1000, "done");
    await closed;
    await waitUntil(() => closeCalls === 1, "close handler");
    expect(peers.size).toBe(1);
  } finally {
    await handle.stop(true);
  }
});

test("fragmented and ArrayBuffer frames normalize before handlers", () => {
  expect(normalizeMessage([Buffer.from("he"), Buffer.from("llo")], false)).toBe("hello");
  const binary = normalizeMessage([Buffer.from([1]), Buffer.from([2])], true);
  expect(binary).toBeInstanceOf(Uint8Array);
  expect([...binary]).toEqual([1, 2]);
  const fromArrayBuffer = normalizeMessage(new Uint8Array([3, 4]).buffer, true);
  expect([...fromArrayBuffer]).toEqual([3, 4]);
});

test("close and error call the close handler exactly once", async () => {
  const events = new EventEmitter() as unknown as WsSocket;
  let closeCalls = 0;
  let terminated = false;
  Object.assign(events, {
    readyState: WebSocket.OPEN,
    send() {},
    close() {},
    terminate() { terminated = true; },
  });
  const peer: WebSocketPeer<TestData> = { data: { sessionId: "fake" }, send() {}, close() {} };

  attachPeerHandlers(events, peer, { close() { closeCalls++; } });
  events.emit("error", new Error("boom"));
  events.emit("close", 1006, Buffer.alloc(0));

  expect(closeCalls).toBe(1);
  expect(terminated).toBe(true);

  const handle = await createNodeHttpServer().serve(testOptions({
    websocket: {
      open(peer) { peer.send(JSON.stringify({ type: "ready" })); },
      close() { closeCalls++; },
    },
  }));
  try {
    const { ws } = await openWebSocket(`ws://127.0.0.1:${handle.port}/ws/session-abrupt`);
    const next = messageQueue(ws);
    await next();
    ws.terminate();
    await waitUntil(() => closeCalls === 2, "abrupt close handler");
  } finally {
    await handle.stop(true);
  }
});

test("stop(false) does not wait for an active WebSocket; stop(true) closes it", async () => {
  const handle = await createNodeHttpServer().serve(testOptions());
  try {
    const { ws } = await openWebSocket(`ws://127.0.0.1:${handle.port}/ws/session-1`);
    const next = messageQueue(ws);
    expect(JSON.parse(await next())).toEqual({ type: "session.ready", sessionId: "session-1" });
    const closed = waitForClose(ws);

    const startedAt = Date.now();
    await handle.stop(false);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(ws.readyState).toBe(WebSocket.OPEN);

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

    await handle.stop(true);
    const closeEvent = await closed;
    expect(closeEvent.code).toBe(1001);
    expect(closeEvent.reason).toBe("server shutdown");

    await handle.stop(true);
    await handle.stop(false);
  } finally {
    await handle.stop(true);
  }
});

test("admin loopback forms work through isAdminRequest and the Node context", async () => {
  const token = "admin-secret";
  const handle = await createNodeHttpServer().serve(testOptions({
    async fetch(req, ctx) {
      if (new URL(req.url).pathname !== "/admin") return new Response("Not Found", { status: 404 });
      return isAdminRequest(req, ctx, token)
        ? Response.json({ ok: true })
        : Response.json({ error: "Forbidden" }, { status: 403 });
    },
  }));
  try {
    const base = `http://127.0.0.1:${handle.port}/admin`;
    expect((await fetch(base, { headers: { "x-atom-admin-token": token } })).status).toBe(200);
    expect((await fetch(base, { headers: { "x-atom-admin-token": "wrong" } })).status).toBe(403);
    expect((await fetch(base)).status).toBe(403);

    const request = new Request("http://127.0.0.1/", { headers: { "x-atom-admin-token": token } });
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(isAdminRequest(request, { ip }, token)).toBe(true);
    }
    expect(isAdminRequest(request, { ip: "203.0.113.5" }, token)).toBe(false);
    expect(isAdminRequest(request, { ip: "203.0.113.5" }, token, true)).toBe(true);
    expect(isAdminRequest(request, { ip: "" }, token, true)).toBe(false);
  } finally {
    await handle.stop(true);
  }
});
