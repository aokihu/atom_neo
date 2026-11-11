/**
 * Exact type shim for the Bun-only OpenTUI runtime plugin entrypoint.
 *
 * The real declaration imports `bun` types through `@opentui/core/runtime-plugin`.
 * `ensureBunRuntimePluginSupport()` only imports it when the Bun global exists,
 * so the Node typecheck maps the specifier here instead of pulling in
 * `@types/bun`. The call site passes no options.
 */
export declare function ensureRuntimePluginSupport(): boolean;
