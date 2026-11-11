/**
 * Builds the transport selected by `resolveHttpRuntime`.
 *
 * Adapters are imported dynamically so the factory owns runtime selection;
 * the Node branch is intentionally unavailable until S9-C.
 */
import { resolveHttpRuntime } from "./detect";
import type { HttpRuntime, HttpServer } from "./types";

export async function createHttpServer(runtime: HttpRuntime = resolveHttpRuntime()): Promise<HttpServer> {
  if (runtime === "bun") {
    const { createBunHttpServer } = await import("./bun-http-server");
    return createBunHttpServer();
  }
  throw new Error("Node HTTP runtime is not available until S9-C");
}
