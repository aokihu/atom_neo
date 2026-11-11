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
