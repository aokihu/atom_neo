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
    const { createBunHttpServer } = await import("./bun-http-server");
    return createBunHttpServer();
  }
  const { createNodeHttpServer } = await import("./node-http-server");
  return createNodeHttpServer();
}
