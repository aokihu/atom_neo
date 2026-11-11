/**
 * Node typecheck shim for the Bun-only HTTP adapter.
 *
 * `tsconfig.node.json` sets `moduleSuffixes: [".node", ""]`, so resolving
 * `./bun-http-server` from `create-http-server.ts` picks this declaration first.
 * The real `bun-http-server.ts` stays in the Bun typecheck/build graph and in
 * the emitted JavaScript, which keeps `bun run build` output resolvable.
 *
 * This file is excluded from the shared workspace build; it is type-only.
 */
import type { HttpServer } from "./types";

export declare function createBunHttpServer(): HttpServer;
