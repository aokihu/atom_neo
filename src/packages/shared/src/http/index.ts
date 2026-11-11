/**
 * HTTP runtime contracts and runtime detection.
 * Adapters (Bun in S9-B, Node in S9-C) implement `HttpServer` behind this boundary.
 */
export type {
  HttpRuntime,
  HttpRequestContext,
  UpgradeDecision,
  HttpRouter,
  WebSocketPeer,
  WebSocketHandlers,
  HttpServerOptions,
  HttpServerHandle,
  HttpServer,
} from "./types";
export { resolveHttpRuntime } from "./detect";
export { createBunHttpServer } from "./bun-http-server";
export { createHttpServer } from "./create-http-server";
// `bun-http-server.ts` stays exported; tsconfig.node.json resolves it to the
// type-only bun-http-server.node.ts via moduleSuffixes, so the Node program
// never loads Bun globals.
