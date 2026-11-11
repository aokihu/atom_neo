/**
 * Transport contracts shared by the Bun and Node HTTP adapters.
 * Business code depends on these types only; adapters own the runtime-specific pieces.
 */

export type HttpRuntime = "bun" | "node";

export type HttpRequestContext = {
  readonly runtime: HttpRuntime;
  readonly ip: string;
  readonly port: number;
};

export type UpgradeDecision<TData = unknown> =
  | { data: TData }
  | { response: Response };

export type HttpRouter<TData = unknown> = {
  fetch(req: Request, ctx: HttpRequestContext): Promise<Response>;
  upgrade?(req: Request, ctx: HttpRequestContext): UpgradeDecision<TData> | undefined;
};

export type WebSocketPeer<TData = unknown> = {
  readonly data: TData;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type WebSocketHandlers<TData = unknown> = {
  open?(peer: WebSocketPeer<TData>): void;
  message?(peer: WebSocketPeer<TData>, data: string | Uint8Array): void;
  close?(peer: WebSocketPeer<TData>, code?: number, reason?: string): void;
  drain?(peer: WebSocketPeer<TData>): void;
};

export type HttpServerOptions<TData = unknown> = {
  port: number;
  host: string;
  fetch(req: Request, ctx: HttpRequestContext): Promise<Response>;
  upgrade?(req: Request, ctx: HttpRequestContext): UpgradeDecision<TData> | undefined;
  websocket?: WebSocketHandlers<TData>;
};

export type HttpServerHandle = {
  readonly port: number;
  readonly runtime: HttpRuntime;
  stop(force?: boolean): Promise<void>;
};

export interface HttpServer {
  serve<TData = unknown>(options: HttpServerOptions<TData>): Promise<HttpServerHandle>;
}
