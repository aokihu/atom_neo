/**
 * Bun implementation of the `HttpServer` contract.
 *
 * Runtime-specific pieces stay here: the Bun server handle, peer IP lookup,
 * the single successful-upgrade path and Bun's two-stage shutdown.
 */
import type { HttpRequestContext, HttpServer, HttpServerHandle, HttpServerOptions } from "./types";

function createFetchHandler<TData>(
  options: HttpServerOptions<TData>,
): (req: Request, srv: Bun.Server<unknown>) => Response | undefined | Promise<Response> {
  return (req, srv) => {
    const ctx: HttpRequestContext = {
      runtime: "bun",
      ip: srv.requestIP(req)?.address ?? "",
      port: srv.port ?? options.port,
    };
    const decision = options.upgrade?.(req, ctx);
    if (decision && "response" in decision) return decision.response;
    if (decision) {
      const upgraded = srv.upgrade(req, { data: decision.data });
      return upgraded ? undefined : new Response("Upgrade Required", { status: 426 });
    }
    return options.fetch(req, ctx);
  };
}

export function createBunHttpServer(): HttpServer {
  return {
    async serve<TData>(options: HttpServerOptions<TData>): Promise<HttpServerHandle> {
      const fetch = createFetchHandler(options);
      // Bun's peer carries `unknown` upgrade data while Core narrows it to WsData;
      // runtime shapes are structurally compatible, so cast only at this boundary.
      const websocket = options.websocket as Bun.WebSocketHandler<unknown> | undefined;
      const server = websocket
        ? Bun.serve<unknown>({ port: options.port, hostname: options.host, fetch, websocket })
        : Bun.serve<unknown>({
            port: options.port,
            hostname: options.host,
            // Without a websocket handler `upgrade` cannot succeed; keep fetch
            // total so this variant satisfies Bun's non-upgrade signature.
            fetch: async (req, srv) => (await fetch(req, srv)) ?? new Response("Upgrade Required", { status: 426 }),
          });

      let graceful: Promise<void> | null = null;
      let forced: Promise<void> | null = null;

      return {
        port: server.port ?? options.port,
        runtime: "bun",
        stop(force = false) {
          if (force) {
            return forced ??= (async () => {
              await graceful;
              await server.stop(true);
            })();
          }
          // Bun's stop(false) can wait for long-lived WebSockets; the contract
          // only requires that new connections stop being accepted here.
          return graceful ??= (async () => {
            void server.stop(false);
          })();
        },
      };
    },
  };
}
