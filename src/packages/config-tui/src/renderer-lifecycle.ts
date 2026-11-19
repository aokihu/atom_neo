import type { createCliRenderer } from "@opentui/core";

export type ConfigRenderer = Awaited<ReturnType<typeof createCliRenderer>>;

/**
 * OpenTUI releases the stdin/stdout stream lease after the native session closes,
 * while destroy() returns earlier. The close promise is private in the renderer
 * type, so keep this single bridge here instead of duplicating it per entry point.
 */
export function waitForRendererClosed(renderer: ConfigRenderer | undefined, done: () => void): void {
  const closed = (renderer as unknown as { nativeClosed?: Promise<void> } | undefined)?.nativeClosed;
  void Promise.resolve(closed).then(done, done);
}

export function closeRenderer(renderer: ConfigRenderer | undefined, done: () => void): void {
  if (!renderer) {
    done();
    return;
  }
  renderer.destroy();
  waitForRendererClosed(renderer, done);
}
