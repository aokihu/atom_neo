/**
 * Bun-only OpenTUI runtime plugin registration.
 *
 * Node's export of `@opentui/react/runtime-plugin-support` throws on import by
 * design. TUI entrypoints await this guard instead of using a static
 * side-effect import: Bun registers the plugin before the renderer is created,
 * Node skips the import entirely.
 */
import { hasBunRuntime } from "@atom-neo/shared";

export async function ensureBunRuntimePluginSupport(): Promise<void> {
  if (!hasBunRuntime()) return;
  await import("@opentui/react/runtime-plugin-support");
}
