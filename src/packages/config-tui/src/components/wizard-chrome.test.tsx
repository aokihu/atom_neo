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
import { GatewayInstanceForm } from "./GatewayInstanceForm";
import { WizardQuitConfirm } from "../wizard/wizard-overlays";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length > 0) await cleanup.pop()!(); });

async function mountModal(element: ReactNode, options: { width?: number; withChrome?: boolean } = {}) {
  const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const setup = await createTestRenderer({ width: options.width ?? 110, height: 32 });
  const root = createRoot(setup.renderer);
  const content = options.withChrome === false
    ? element
    : <MenuChromeProvider version="9.9.9">{element}</MenuChromeProvider>;
  await act(async () => root.render(<ThemeProvider theme="edex">{content}</ThemeProvider>));
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

test("first-run without MenuChromeProvider renders no version suffix", async () => {
  const frame = await mountModal(
    <ProjectModal value="" onSubmit={() => {}} onBack={() => {}} />,
    { withChrome: false },
  );
  expect(frame).toContain("ATOM NEO · PROJECT INFORMATION");
  expect(frame).not.toContain("v9.9.9");
});

function assertNarrowHeader(frame: string, expectedTitle: string) {
  const lines = frame.split("\n");
  const titleLine = lines.find(line => line.includes(expectedTitle));
  expect(titleLine).toBeDefined();
  expect(titleLine!.trimEnd().replace(/[│]/g, "").trimEnd().endsWith("v9.9.9")).toBe(true);
  const version = titleLine!.indexOf("v9.9.9");
  expect(version).toBeGreaterThan(titleLine!.indexOf(expectedTitle));
  expect(titleLine![version - 1]).toBe(" ");
  expect(lines.filter(line => line.includes("Tab/")).length).toBeLessThanOrEqual(1);
}

test("Confirm and QuitConfirm keep title, version and hint single-line at 40 columns", async () => {
  const confirm = await mountModal(
    <ConfirmModal state={initialState("config")} onSave={() => {}} onBack={() => {}} />,
    { width: 40 },
  );
  assertNarrowHeader(confirm, "SAVE & EXIT");

  const quit = await mountModal(
    <WizardQuitConfirm open onQuit={() => {}} onCancel={() => {}} />,
    { width: 40 },
  );
  assertNarrowHeader(quit, "ATOM NEO");
});

test("GatewayInstanceForm uses unified title, version and width", async () => {
  const frame = await mountModal(
    <GatewayInstanceForm
      fields={{ name: { label: "Name", type: "string" } }}
      mode="create"
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
  );
  expect(frame).toContain("ATOM NEO · INSTANCE CONFIG");
  assertChrome(frame, 64);
});
