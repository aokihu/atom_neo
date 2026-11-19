import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { MenuApp } from "./menu-app";
import type { MenuActions } from "./menu-types";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!();
});

function actions(overrides: Partial<MenuActions> = {}): MenuActions {
  return {
    theme: "edex",
    gatewayPort: 3000,
    gateway: {
      install: async () => "installed",
      load: async () => "loaded",
      pack: async () => "packed",
    },
    hasConfig: () => true,
    validateWorkspace: () => undefined,
    setWorkspace: () => {},
    coreStatus: async () => "offline",
    coreTarget: async () => ({ host: "127.0.0.1", port: 3100 }),
    gatewayStatus: async () => "offline",
    listSessions: async () => [],
    deleteSession: async () => {},
    stopCore: async () => {},
    exportBackup: async () => "exported",
    importBackup: async () => "imported",
    setGatewayPort: () => {},
    ...overrides,
  };
}

async function mount(options: {
  initialRoute?: "home" | "configure" | "gateway";
  workspaceExplicit?: boolean;
  actions?: MenuActions;
} = {}) {
  const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const setup = await createTestRenderer({ width: 100, height: 32 });
  const root = createRoot(setup.renderer);
  const launches: Array<unknown> = [];
  await act(async () => root.render(
    <MenuApp
      sandbox="/tmp/atom-menu"
      workspaceExplicit={options.workspaceExplicit}
      initialRoute={options.initialRoute}
      actions={options.actions ?? actions()}
      onExit={(launch) => { launches.push(launch); }}
    />,
  ));
  await settle();
  cleanup.push(async () => {
    await act(async () => root.unmount());
    setup.renderer.destroy();
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
  });

  async function settle() {
    for (let index = 0; index < 4; index++) {
      await act(async () => { await Bun.sleep(5); });
      await setup.renderOnce();
    }
  }

  const press = async (...keys: string[]) => {
    for (const key of keys) {
      await act(async () => setup.mockInput.pressKey(key));
      await setup.renderOnce();
    }
    await settle();
  };

  return { press, frame: setup.captureCharFrame, launches };
}

test("home shows the integrated menu and workspace status", async () => {
  const app = await mount();
  const frame = app.frame();
  expect(frame).toContain("ATOM NEO · Home");
  expect(frame).toContain("workspace: /tmp/atom-menu");
  expect(frame).toContain("Session");
  expect(frame).toContain("Gateway");
  expect(frame).toContain("Configure");
  expect(frame).toContain("Backup");
  expect(frame).toContain("Quit");
});

test("gateway shortcut goes through workspace confirmation", async () => {
  const app = await mount();
  await app.press("ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("Gateway configuration uses this workspace.");
  expect(app.frame()).toContain("Continue to Gateway");
  await app.press("ESCAPE");
  expect(app.frame()).toContain("ATOM NEO · Home");
});

test("atom config opens Configure and atom config gateway requests workspace when unconfigured", async () => {
  const configured = await mount({ initialRoute: "configure" });
  expect(configured.frame()).toContain("ATOM NEO · Configure");
  expect(configured.frame()).toContain("Workspace path");

  const unconfigured = await mount({
    initialRoute: "gateway",
    actions: actions({ hasConfig: () => false }),
  });
  expect(unconfigured.frame()).toContain("ATOM NEO · Workspace");
  expect(unconfigured.frame()).toContain("Workspace path");
});

test("gateway shortcut Continue reaches the shared GatewayModal", async () => {
  const app = await mount();
  await app.press("ARROW_DOWN", "RETURN");
  await app.press("RETURN");
  expect(app.frame()).toContain("GATEWAY CLIENTS");
});

test("advanced opens the existing wizard and the real Gateway entry", async () => {
  const app = await mount({ initialRoute: "configure" });
  await app.press("ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("ATOM NEO · Advanced");
  await app.press("RETURN");
  expect(app.frame()).toContain("PROVIDERS");

  const gateway = await mount({ initialRoute: "configure" });
  await gateway.press("ARROW_DOWN", "RETURN");
  await gateway.press("ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(gateway.frame()).toContain("GATEWAY CLIENTS");
});

test("backup home exposes Export before Import", async () => {
  const app = await mount();
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("ATOM NEO · Backup");
  expect(app.frame().indexOf("Export")).toBeLessThan(app.frame().indexOf("Import"));
});

test("escape on home opens quit confirmation", async () => {
  const app = await mount();
  await app.press("ESCAPE");
  expect(app.frame()).toContain("Quit Atom Neo");
  expect(app.frame()).toContain("Cancel");
  expect(app.frame()).toContain("Quit");
});
