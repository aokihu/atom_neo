import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { ThemeProvider } from "@atom-neo/tui-kit";
import { MenuChromeProvider } from "../menu/menu-frame";
import { initialState } from "../wizard-logic";
import { ConfirmModal } from "./ConfirmModal";
import { ApiKeyModal } from "./ApiKeyModal";
import { ModelsModal } from "./ModelsModal";
import { ProjectModal } from "./ProjectModal";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length > 0) await cleanup.pop()!(); });

async function mountModal(element: ReactNode) {
  const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const setup = await createTestRenderer({ width: 110, height: 32 });
  const root = createRoot(setup.renderer);
  await act(async () => root.render(
    <ThemeProvider theme="edex">
      <MenuChromeProvider version="9.9.9">{element}</MenuChromeProvider>
    </ThemeProvider>,
  ));
  await act(async () => { await Bun.sleep(10); });
  await setup.renderOnce();
  cleanup.push(async () => {
    await act(async () => root.unmount());
    setup.renderer.destroy();
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
  });
  return setup.captureCharFrame();
}

function assertChrome(frame: string, width: number) {
  const lines = frame.split("\n");
  const title = lines.find(line => line.includes("ATOM NEO"));
  expect(title).toContain("v9.9.9");
  const border = lines.find(line => line.includes("┌"));
  expect(border?.trim().length).toBe(width);
}

test("ConfirmModal uses unified title, version and width", async () => {
  const frame = await mountModal(
    <ConfirmModal state={initialState("config")} onSave={() => {}} onBack={() => {}} />,
  );
  expect(frame).toContain("ATOM NEO · SAVE & EXIT");
  assertChrome(frame, 64);
});

test("ApiKeyModal uses unified title, version and width", async () => {
  const frame = await mountModal(
    <ApiKeyModal provider="deepseek" apiKey="" apiKeyEnv="DEEPSEEK_API_KEY"
      showEnv={false} showBaseUrl={false} onSubmit={() => {}} onCancel={() => {}} />,
  );
  expect(frame).toContain("ATOM NEO · API KEY — DEEPSEEK");
  assertChrome(frame, 60);
});

test("ModelsModal uses unified title, version and width", async () => {
  const frame = await mountModal(
    <ModelsModal provider="deepseek" models={["deepseek-v4-flash"]} thinking="disabled"
      allowJev={false} onSubmit={() => true} onCancel={() => {}} />,
  );
  expect(frame).toContain("ATOM NEO · MODELS — DEEPSEEK");
  assertChrome(frame, 56);
});

test("ProjectModal uses unified title, version and width", async () => {
  const frame = await mountModal(
    <ProjectModal value="" onSubmit={() => {}} onBack={() => {}} />,
  );
  expect(frame).toContain("ATOM NEO · PROJECT INFORMATION");
  assertChrome(frame, 64);
});
