import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import type { ServerInfo } from "../types";
import { SettingsModal } from "./SettingsModal";

const serverInfo: ServerInfo = {
  port: 3100,
  host: "127.0.0.1",
  model: "deepseek-v4-flash",
  sandbox: "/tmp/sandbox",
  version: "1.14.0",
  tools: [],
  theme: "edex",
  thinking: "disabled",
};

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false; });

test("SETTINGS renders the runtime rows and modal actions", async () => {
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => new Response(JSON.stringify({
    providerProfiles: {
      advanced: "deepseek/deepseek-v4-pro",
      balanced: "deepseek/deepseek-v4-flash",
      basic: "deepseek/deepseek-v4-flash",
    },
    providers: { deepseek: { models: ["deepseek-v4-flash"] } },
    tui: { theme: "edex" },
    transport: { maxOutputTokens: 4096 },
  }), { status: 200, headers: { "content-type": "application/json" } });
  const setup = await createTestRenderer({ width: 80, height: 24 });
  const root = createRoot(setup.renderer);
  try {
    await act(async () => {
      root.render(
        <SettingsModal
          open
          url="http://127.0.0.1:3100"
          serverInfo={serverInfo}
          onSaved={() => {}}
          onClose={() => {}}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("RUNTIME SETTINGS");
    expect(frame).toContain("MODEL (advanced)");
    expect(frame).toContain("MODEL (balanced)");
    expect(frame).toContain("MODEL (basic)");
    expect(frame).toContain("MODEL (fast)");
    expect(frame).toContain("TUI THEME");
    expect(frame).toContain("THINKING");
    expect(frame).toContain("MAX OUTPUT TOKENS");
    expect(frame).toContain("deepseek/deepseek-v4-flash");
    expect(frame).toContain("4096");
    expect(frame).toContain("Cancel");
    expect(frame).toContain("Reset to config.json");
    expect(frame).toContain("Save");
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
    globalThis.fetch = originalFetch;
  }
});
