import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { buildInitialState, readJsonFile } from "../wizard-logic";
import type { WizardMode } from "../wizard-logic";
import { WizardApp } from "./WizardApp";

test("adds OpenRouter Jev during setup and can clear its Fast profile in config mode", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "atom-jev-wizard-"));
  const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

  async function openWizard(mode: WizardMode, run: (ui: {
    press: (...keys: string[]) => Promise<void>;
    type: (value: string) => Promise<void>;
    frame: () => string;
  }) => Promise<void>) {
    const setup = await createTestRenderer({ width: 100, height: 36 });
    const root = createRoot(setup.renderer);
    try {
      await act(async () => root.render(<WizardApp sandboxPath={sandbox} mode={mode}
        onComplete={() => {}} onAbort={() => { throw new Error("Unexpected abort"); }} />));
      await setup.renderOnce();
      await run({
        press: async (...keys) => {
          for (const key of keys) {
            await act(async () => setup.mockInput.pressKey(key));
            await setup.renderOnce();
          }
        },
        type: async value => {
          await act(async () => setup.mockInput.pasteBracketedText(value));
          await setup.renderOnce();
        },
        frame: setup.captureCharFrame,
      });
    } finally {
      await act(async () => root.unmount());
      setup.renderer.destroy();
    }
  }

  try {
    await openWizard("first-run", async ({ press, type, frame }) => {
      await press("RETURN");
      await type("test-deepseek-key");
      await press("RETURN", "RETURN", "RETURN", "RETURN", "RETURN", "RETURN");
      expect(frame()).toContain("MODEL PROFILES");
      await press("TAB", "RETURN");
      expect(frame()).toContain("DECISIONS");

      // First Left/Right/Tab focuses the action bar; the next Left cycles actions.
      await press("ARROW_LEFT", "ARROW_LEFT", "RETURN");
      expect(frame()).toContain("Add OpenRouter Jev");
      await press("ARROW_DOWN", "RETURN");
      await type("test-openrouter-key");
      await press("RETURN", "RETURN", "RETURN");
      expect(frame()).toContain("Decisions endpoint (full URL)");
      expect(frame()).toContain("https://openrouter.ai/api/alpha/decisions");
      await press("RETURN", "ARROW_UP", "RETURN");
      expect(frame()).toContain("DECISIONS");

      await press("RETURN", "RETURN", "RETURN", "ARROW_DOWN", "RETURN", "ARROW_DOWN", "RETURN");
      expect(frame()).toContain("openrouter-jev/typesafe/jev-1.13");
      await press("TAB", "RETURN");
      expect(frame()).toContain("THEME");
      await press("RETURN");
      expect(frame()).toContain("PROJECT");
      await press("RETURN");
      expect(frame()).toContain("SAVE & EXIT");
      await press("RETURN");
    });

    const saved = buildInitialState("config", sandbox);
    expect(saved.profiles).toMatchObject({
      advanced: "deepseek/deepseek-v4-flash",
      basic: "deepseek/deepseek-v4-flash",
      fast: "openrouter-jev/typesafe/jev-1.13",
    });
    expect(saved.decisionMode).toEqual({ prediction: "jev", postConversation: "jev", continuation: "jev" });
    expect(saved.editedProviders["openrouter-jev"]).toMatchObject({
      type: "jev", apiKeyEnv: "OPENROUTER_API_KEY", apiKey: "test-openrouter-key",
      baseUrl: "https://openrouter.ai/api/alpha/decisions",
    });
    expect(readJsonFile(join(sandbox, "config.json"))?.providers["openrouter-jev"].apiKey).toBeUndefined();

    await openWizard("config", async ({ press, frame }) => {
      await press("ARROW_DOWN", "ARROW_DOWN", "RETURN");
      expect(frame()).toContain("openrouter-jev/typesafe/jev-1.13");
      await press("RETURN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN", "TAB", "RETURN");
      await press("ARROW_UP", "RETURN", "RETURN");
    });
    const updated = buildInitialState("config", sandbox);
    expect(updated.profiles.fast).toBeUndefined();
    expect(updated.decisionMode.continuation).toBe("rules");
    expect(updated.editedProviders["openrouter-jev"].apiKey).toBe("test-openrouter-key");
  } finally {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
    rmSync(sandbox, { recursive: true, force: true });
  }
});
