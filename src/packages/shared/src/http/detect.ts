/**
 * Runtime selection for HTTP transports.
 *
 * Bun stays the default whenever its global exists; `ATOM_HTTP_RUNTIME` (or an
 * explicit argument) forces a runtime. Adapter construction arrives in S9-B/C.
 */
import type { HttpRuntime } from "./types";

export type { HttpRuntime };

export function resolveHttpRuntime(explicit?: string): HttpRuntime {
  const value = explicit ?? process.env.ATOM_HTTP_RUNTIME;
  if (value === "bun" || value === "node") return value;
  return typeof Bun !== "undefined" ? "bun" : "node";
}
