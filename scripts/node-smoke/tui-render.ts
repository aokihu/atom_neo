/**
 * Node TUI render smoke.
 *
 * Uses the OpenTUI test renderer under Node, not just an import probe:
 * renders a bordered box, captures the character frame, verifies content and
 * border, then unmounts/destroys cleanly.
 */
import { strict as assert } from "node:assert";
import React, { act } from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function main(): Promise<void> {
  const setup = await createTestRenderer({ width: 28, height: 5 });
  const root = createRoot(setup.renderer);
  try {
    await act(async () => {
      root.render(
        React.createElement(
          "box",
          { border: true, width: 28, height: 5 },
          React.createElement("text", null, "NODE_TUI_RENDER_OK"),
        ),
      );
      await Promise.resolve();
    });
    await setup.renderOnce();
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    assert.match(frame, /NODE_TUI_RENDER_OK/);
    assert.match(frame, /┌/);
    assert.match(frame, /└/);

    await act(async () => {
      root.unmount();
    });
    setup.renderer.destroy();
    console.log("PASS tui-render-on-node");
    console.log("PASS all (1 check)");
  } catch (error) {
    try {
      setup.renderer.destroy();
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("FAIL", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
