/**
 * Node implementation of the `HttpServer` contract.
 *
 * Bridges `node:http` to Web `Request`/`Response` and `ws` sockets to the
 * transport-agnostic `WebSocketPeer` contract. Core/Gateway stay unchanged.
 */
import { STATUS_CODES, createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Duplex } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { attachPeerHandlers, createPeerRegistry } from "./node-websocket-peer";
import type { HttpRequestContext, HttpServer, HttpServerHandle, HttpServerOptions, WebSocketPeer } from "./types";

type NodeRequestInit = RequestInit & { duplex?: "half" };

function abortSignalFor(req: IncomingMessage): AbortSignal {
  const controller = new AbortController();
  req.once("aborted", () => controller.abort());
  req.once("close", () => {
    if (!req.complete) controller.abort();
  });
  return controller.signal;
}

/** `IncomingMessage` -> Web `Request`; GET/HEAD never carry a body. */
function toWebRequest(req: IncomingMessage, port: number): Request {
  const host = req.headers.host ?? `127.0.0.1:${port}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
  }
  const method = req.method ?? "GET";
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
  const init: NodeRequestInit = {
    method,
    headers,
    body,
    duplex: "half",
    signal: abortSignalFor(req),
  };
  return new Request(url, init);
}

function requestContext(req: IncomingMessage, port: number): HttpRequestContext {
  return { runtime: "node", ip: req.socket.remoteAddress ?? "", port };
}

function copyHeaders(res: ServerResponse, response: Response): void {
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === "set-cookie") continue;
    res.setHeader(key, value);
  }
  const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);
}

/** Web `Response` -> `ServerResponse`; never writes a body for 204/304/HEAD. */
async function writeWebResponse(req: IncomingMessage, res: ServerResponse, response: Response): Promise<void> {
  if (res.destroyed || res.writableEnded) {
    if (response.body) void response.body.cancel().catch(() => {});
    return;
  }
  res.statusCode = response.status;
  copyHeaders(res, response);

  if (response.status === 204 || response.status === 304 || req.method === "HEAD" || !response.body) {
    if (response.body) void response.body.cancel().catch(() => {});
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>), res);
  } catch (error) {
    if (!res.destroyed) res.destroy(error instanceof Error ? error : undefined);
  }
}

async function handleRequest<TData>(
  req: IncomingMessage,
  res: ServerResponse,
  options: HttpServerOptions<TData>,
  port: number,
): Promise<void> {
  req.on("error", () => {});
  res.on("error", () => {});
  try {
    const response = await options.fetch(toWebRequest(req, port), requestContext(req, port));
    await writeWebResponse(req, res, response);
  } catch {
    if (res.headersSent || res.destroyed || res.writableEnded) {
      if (!res.destroyed) res.destroy();
      return;
    }
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Internal error" }));
  }
}

function writeRawResponse(socket: Duplex, status: number, headers: Array<[string, string]>, body: Buffer): void {
  if (socket.destroyed) return;
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  const lines = [`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? "Unknown"}`];
  for (const [key, value] of headers) lines.push(`${key}: ${value}`);
  lines.push(`content-length: ${body.length}`, "connection: close", "", "");
  socket.end(Buffer.concat([Buffer.from(lines.join("\r\n")), body]), () => socket.destroy());
}

function rejectUpgrade(socket: Duplex, status: number, body: string): void {
  writeRawResponse(socket, status, [["content-type", "text/plain; charset=utf-8"]], Buffer.from(body));
}

/** Serialize a `Response` returned by an upgrade decision onto the raw socket. */
async function writeResponseToSocket(socket: Duplex, response: Response): Promise<void> {
  const body = response.status === 204 || response.status === 304 || !response.body
    ? Buffer.alloc(0)
    : Buffer.from(await response.arrayBuffer());
  const headers: Array<[string, string]> = [];
  for (const [key, value] of response.headers) {
    const lower = key.toLowerCase();
    if (lower === "set-cookie" || lower === "content-length") continue;
    headers.push([key, value]);
  }
  const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const cookie of cookies) headers.push(["set-cookie", cookie]);
  writeRawResponse(socket, response.status, headers, body);
}

async function handleUpgrade<TData>(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: HttpServerOptions<TData>,
  wss: WebSocketServer,
  peers: (socket: WebSocket, data: TData) => WebSocketPeer<TData>,
  port: number,
): Promise<void> {
  let request: Request;
  try {
    request = toWebRequest(req, port);
  } catch {
    rejectUpgrade(socket, 400, "Bad Request");
    return;
  }

  const decision = options.upgrade?.(request, requestContext(req, port));
  if (!decision) {
    rejectUpgrade(socket, 404, "Not Found");
    return;
  }
  if ("response" in decision) {
    await writeResponseToSocket(socket, decision.response);
    return;
  }
  const websocket = options.websocket;
  if (!websocket) {
    rejectUpgrade(socket, 426, "Upgrade Required");
    return;
  }
  try {
    wss.handleUpgrade(req, socket, head, (ws) => {
      attachPeerHandlers(ws, peers(ws, decision.data), websocket);
    });
  } catch {
    if (!socket.destroyed) socket.destroy();
  }
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    try {
      wss.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

export function createNodeHttpServer(): HttpServer {
  return {
    async serve<TData>(options: HttpServerOptions<TData>): Promise<HttpServerHandle> {
      let port = options.port;
      const wss = new WebSocketServer({ noServer: true });
      const peers = createPeerRegistry<TData>();
      const server = createServer((req, res) => {
        void handleRequest(req, res, options, port).catch(() => {
          if (!res.destroyed) res.destroy();
        });
      });

      server.on("clientError", (_error, socket) => {
        if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nconnection: close\r\ncontent-length: 0\r\n\r\n", () => socket.destroy());
        else socket.destroy();
      });

      server.on("upgrade", (req, socket, head) => {
        void handleUpgrade(req, socket, head, options, wss, peers, port).catch(() => {
          if (!socket.destroyed) socket.destroy();
        });
      });

      wss.on("error", () => {});

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(options.port, options.host, () => {
          server.off("error", onError);
          server.on("error", () => {});
          const address = server.address();
          if (address && typeof address !== "string") port = address.port;
          resolve();
        });
      });

      let graceful: Promise<void> | null = null;
      let forced: Promise<void> | null = null;
      let closing: Promise<void> | null = null;
      const closeListening = (): Promise<void> => closing ??= closeServer(server);

      return {
        port,
        runtime: "node",
        stop(force = false) {
          if (force) {
            return forced ??= (async () => {
              await graceful;
              const closed = closeListening();
              for (const socket of wss.clients) {
                try {
                  socket.close(1001, "server shutdown");
                } catch {
                  socket.terminate();
                }
              }
              server.closeAllConnections?.();
              await Promise.all([closeWebSocketServer(wss), closed]);
            })();
          }
          // Node's close() waits for active connections; only stop accepting
          // here and close idle keep-alive sockets.
          return graceful ??= (async () => {
            void closeListening();
            server.closeIdleConnections?.();
          })();
        },
      };
    },
  };
}
