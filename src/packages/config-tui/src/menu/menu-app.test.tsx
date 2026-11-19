import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { MenuApp } from "./menu-app";
import type { MenuActions } from "./menu-types";

const cleanup: Array<() => Promise<void>> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!();
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
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
    setWorkspace: (path) => path,
    refreshSettings: () => ({ theme: "edex", gatewayPort: 3000 }),
    coreStatus: async () => "offline",
    coreTarget: async () => ({ host: "127.0.0.1", port: 3100 }),
    coreStartTarget: () => ({ host: "127.0.0.1", port: 3100 }),
    gatewayStatus: async () => "offline",
    listSessions: async () => [],
    deleteSession: async () => {},
    stopCore: async () => {},
    exportBackup: async () => "exported",
    importBackup: async () => "imported",
    validateBackupPassword: (password) => password.length < 8 ? "Password must be at least 8 characters" : undefined,
    inspectBackup: async () => ({ encrypted: false }),
    setGatewayPort: () => {},
    ...overrides,
  };
}

async function mount(options: {
  initialRoute?: "home" | "configure" | "gateway";
  initialError?: string;
  sandbox?: string;
  version?: string;
  actions?: MenuActions;
} = {}) {
  const sandbox = options.sandbox ?? "/tmp/atom-menu";
  const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const setup = await createTestRenderer({ width: 100, height: 32 });
  const root = createRoot(setup.renderer);
  const launches: Array<unknown> = [];
  await act(async () => root.render(
    <MenuApp
      sandbox={sandbox}
      initialRoute={options.initialRoute}
      initialError={options.initialError}
      version={options.version}
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

  const type = async (value: string) => {
    await act(async () => setup.mockInput.pasteBracketedText(value));
    await settle();
  };

  return { press, type, frame: setup.captureCharFrame, launches };
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

test("top bar shows the injected version and route breadcrumb", async () => {
  const app = await mount({ initialRoute: "configure", version: "9.9.9" });
  expect(app.frame()).toContain("Home / Configure");
  expect(app.frame()).toContain("v9.9.9");
});

test("failed launch feedback is shown on the home screen", async () => {
  const app = await mount({ initialError: "Launch failed: EADDRINUSE" });
  expect(app.frame()).toContain("Launch failed: EADDRINUSE");
});

test("gateway shortcut supports the C change-workspace hint", async () => {
  const app = await mount();
  await app.press("ARROW_DOWN", "RETURN");
  await app.press("c");
  expect(app.frame()).toContain("ATOM NEO · Workspace");
});

test("gateway port edit refreshes the Configure summary", async () => {
  const ports: number[] = [];
  const app = await mount({
    initialRoute: "gateway",
    actions: actions({
      gatewayPort: 0,
      setGatewayPort: (port) => { ports.push(port); },
    }),
  });
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  await app.press("END", "BACKSPACE", "BACKSPACE", "BACKSPACE", "BACKSPACE");
  await app.type("4321");
  await app.press("RETURN", "ESCAPE");
  expect(ports).toEqual([4321]);
  expect(app.frame()).toContain("Gateway port 4321");
});

test("gateway port save errors stay inline in the modal", async () => {
  const app = await mount({
    initialRoute: "gateway",
    actions: actions({
      gatewayPort: 0,
      setGatewayPort: () => { throw new Error("Invalid config.json: Unexpected token"); },
    }),
  });
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  await app.press("END", "BACKSPACE", "BACKSPACE", "BACKSPACE", "BACKSPACE");
  await app.type("4321");
  await app.press("RETURN");
  expect(app.frame()).toContain("Invalid config.json");
  expect(app.frame()).toContain("GATEWAY PORT");
});

test("saving the theme wizard refreshes Advanced and returns there", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "atom-menu-theme-"));
  tempDirs.push(sandbox);
  const app = await mount({
    sandbox,
    initialRoute: "configure",
    actions: actions({ refreshSettings: () => ({ theme: "nord", gatewayPort: 3000 }) }),
  });
  await app.press("ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("Current: edex");
  await app.press("ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("THEME");
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("SAVE & EXIT");
  await app.press("RETURN");
  expect(app.frame()).toContain("ATOM NEO · Advanced");
  expect(app.frame()).toContain("Current: nord");
});

test("wizard menu may open the shared GatewayModal and returns to the wizard", async () => {
  const app = await mount({ initialRoute: "configure" });
  await app.press("ARROW_DOWN", "RETURN");
  await app.press("RETURN");
  expect(app.frame()).toContain("PROVIDERS");
  await app.press("ESCAPE");
  expect(app.frame()).toContain("CONFIGURATION");
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("GATEWAY CLIENTS");
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
