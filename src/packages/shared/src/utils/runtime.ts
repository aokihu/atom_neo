/**
 * Runtime detection helpers.
 *
 * The Node typecheck (`tsconfig.node.json`) intentionally does not include
 * `@types/bun`, so production code must not reference the `Bun` global
 * directly. Use these helpers instead.
 */

/** True when the Bun global is available (Bun source runtime or compiled binary). */
export function hasBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}
