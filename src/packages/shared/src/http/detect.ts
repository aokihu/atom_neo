/**
 * Runtime selection for HTTP transports.
 *
 * Bun stays the default whenever its global exists; `ATOM_HTTP_RUNTIME` (or an
 * explicit argument) forces a runtime. Invalid values fail fast instead of
 * silently falling back, so a typo cannot start the wrong adapter.
 */
import type { HttpRuntime } from "./types";

export type { HttpRuntime };

function parseRuntime(value: string | undefined, source: string): HttpRuntime | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized === "") return undefined;
  if (normalized === "bun" || normalized === "node") return normalized;
  throw new Error(`Invalid ${source} "${value}": expected "bun" | "node".`);
}

export function resolveHttpRuntime(explicit?: string): HttpRuntime {
  return parseRuntime(explicit, "HTTP runtime")
    ?? parseRuntime(process.env.ATOM_HTTP_RUNTIME, "ATOM_HTTP_RUNTIME")
    ?? (typeof Bun !== "undefined" ? "bun" : "node");
}
