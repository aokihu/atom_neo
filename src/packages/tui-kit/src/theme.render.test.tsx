import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { ThemeProvider, getTheme, useTheme } from "./theme";
import type { ThemeValue } from "./theme";

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false }); });

async function waitForFrame(setup: Awaited<ReturnType<typeof createTestRenderer>>, text: string) {
  const until = Date.now() + 2_000;
  while (Date.now() < until) {
    await setup.renderOnce();
    if (setup.captureCharFrame().includes(text)) return;
    await Bun.sleep(10);
  }
  throw new Error(`Frame did not contain ${text}`);
}

test("ThemeProvider attaches a renderer-owned syntax style", async () => {
  const setup = await createTestRenderer({ width: 20, height: 4 });
  const root = createRoot(setup.renderer);
  let value!: ThemeValue;
  function Probe() {
    value = useTheme();
    return <text>theme</text>;
  }
  try {
    await act(async () => root.render(<ThemeProvider theme="edex"><Probe /></ThemeProvider>));
    await setup.renderOnce();
    expect(value.syntaxStyle).toBeDefined();
    expect(value.colors).toBe(getTheme("edex").colors);
    expect(setup.captureCharFrame()).toContain("theme");
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  }
});

test("markdown renders with the provided syntax style", async () => {
  const setup = await createTestRenderer({ width: 30, height: 5 });
  const root = createRoot(setup.renderer);
  function Probe() {
    const { syntaxStyle } = useTheme();
    return syntaxStyle ? <markdown content="MARKDOWN_OK" streaming={false} syntaxStyle={syntaxStyle} width="100%" /> : null;
  }
  try {
    await act(async () => root.render(<ThemeProvider theme="edex"><Probe /></ThemeProvider>));
    await setup.renderOnce();
    await waitForFrame(setup, "MARKDOWN_OK");
    expect(setup.captureCharFrame()).toContain("MARKDOWN_OK");
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  }
});
