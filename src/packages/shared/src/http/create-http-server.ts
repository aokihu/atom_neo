/**
 * Builds the transport selected by `resolveHttpRuntime`.
 *
 * Adapters are imported dynamically so the factory owns runtime selection and
 * Bun/TUI never eagerly load the Node-only `ws` dependency.
 */
import { resolveHttpRuntime } from "./detect";
import type { HttpRuntime, HttpServer } from "./types";

export async function createHttpServer(runtime: HttpRuntime = resolveHttpRuntime()): Promise<HttpServer> {
  if (runtime === "bun") {
    if (typeof Bun === "undefined") {
      throw new Error('Bun HTTP runtime requested but the Bun global is unavailable. Set ATOM_HTTP_RUNTIME=node to use the Node adapter.');
    }
    const { createBunHttpServer } = await import("./bun-http-server");
    return createBunHttpServer();
  }
  if (runtime === "node") {
    const { createNodeHttpServer } = await import("./node-http-server");
    return createNodeHttpServer();
  }
  throw new Error(`Invalid HTTP runtime "${String(runtime)}": expected "bun" | "node".`);
}
