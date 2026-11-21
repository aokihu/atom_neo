import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { stringWidth } from "@atom-neo/shared";
import { MenuApp } from "./menu-app";
import { MenuChromeProvider, MenuScreen, menuContentWidth } from "./menu-frame";
import { breadcrumbFor } from "./menu-routes";
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
    normalizeWorkspace: (path) => path,
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
  width?: number;
  height?: number;
  actions?: MenuActions;
} = {}) {
  const sandbox = options.sandbox ?? "/tmp/atom-menu";
  const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const setup = await createTestRenderer({ width: options.width ?? 100, height: options.height ?? 32 });
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

async function mountNode(element: ReactNode) {
  const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const setup = await createTestRenderer({ width: 40, height: 24 });
  const root = createRoot(setup.renderer);
  await act(async () => root.render(element));
  for (let index = 0; index < 4; index++) {
    await act(async () => { await Bun.sleep(5); });
    await setup.renderOnce();
  }
  cleanup.push(async () => {
    await act(async () => root.unmount());
    setup.renderer.destroy();
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
  });
  return { frame: setup.captureCharFrame };
}

test("home shows the integrated menu and workspace status without a breadcrumb", async () => {
  const app = await mount();
  const frame = app.frame();
  expect(frame).toContain("ATOM NEO · Home");
  expect(frame).toContain("workspace: /tmp/atom-menu");
  expect(frame).toContain("Session");
  expect(frame).toContain("Gateway");
  expect(frame).toContain("Configure");
  expect(frame).toContain("Backup");
  expect(frame).toContain("Quit");
  expect(frame).toContain("SESSION");
  expect(frame).toContain("Chat with the current agent.");
  const lines = frame.split("\n");
  const title = lines.findIndex(line => line.includes("ATOM NEO · Home"));
  expect(lines[title + 1]).toContain("workspace: /tmp/atom-menu");
  expect(lines[title + 1]!.trim()).not.toBe("");
  expect(lines[title + 2]).toContain("Gateway:");
  expect(lines.filter(line => line.replace(/[│]/g, "").trim() === "Home")).toHaveLength(0);
});

test("breadcrumbFor only returns parent context not represented by the title", () => {
  for (const route of [
    { name: "home" }, { name: "session" }, { name: "history" }, { name: "core-server" },
    { name: "gateway-shortcut" }, { name: "configure" }, { name: "backup" },
    { name: "backup-export" }, { name: "backup-import" },
  ] as const) {
    expect(breadcrumbFor(route)).toBeUndefined();
  }
  expect(breadcrumbFor({ name: "gateway-real", back: "configure" })).toBe("Home / Configure / Gateway");
  expect(breadcrumbFor({ name: "gateway-real", back: "gateway-shortcut" })).toBe("Home / Gateway / Configuration");
  expect(breadcrumbFor({ name: "workspace", after: "configure" })).toBe("Home / Configure / Workspace");
  expect(breadcrumbFor({ name: "workspace", after: "gateway-shortcut" })).toBe("Home / Gateway / Workspace");
  expect(breadcrumbFor({ name: "workspace", after: "gateway-real" })).toBe("Gateway / Workspace");
});

test.each([100, 64, 40])("home at %i columns has no breadcrumb and keeps workspace/status adjacent", async (width) => {
  const app = await mount({ version: "1.2.3", width });
  const lines = app.frame().split("\n");
  const title = lines.findIndex(line => line.includes("ATOM NEO · Home"));
  expect(lines[title]).toContain("v1.2.3");
  expect(lines[title]!.replace(/[│]/g, "").trimEnd().endsWith("v1.2.3")).toBe(true);
  expect(lines[title + 1]).toContain("workspace:");
  expect(lines[title + 1]!.trim()).not.toBe("");
  expect(lines.filter(line => line.includes("workspace:"))).toHaveLength(1);
  expect(lines[title + 2]).toContain("Gateway:");
  expect(lines.filter(line => line.includes("Gateway:"))).toHaveLength(1);
  expect(lines.filter(line => line.replace(/[│]/g, "").trim() === "Home")).toHaveLength(0);
  if (width >= 80) expect(app.frame()).toContain("Chat with the current agent.");
  else if (width >= 64) expect(app.frame()).toContain("Chat and Core server");
  else expect(app.frame()).not.toContain("Chat and Core server");
});

function assertTitleOwnsContext(frame: string, title: string, absentCrumb: string) {
  const lines = frame.split("\n");
  const index = lines.findIndex(line => line.includes(title));
  expect(index).toBeGreaterThanOrEqual(0);
  expect(lines[index + 1]).toContain("workspace:");
  expect(lines.some(line => line.includes(absentCrumb))).toBe(false);
}

test("title-owned pages render no breadcrumb", async () => {
  const session = await mount();
  await session.press("RETURN");
  assertTitleOwnsContext(session.frame(), "ATOM NEO · Session", "Home / Session");

  const history = await mount();
  await history.press("RETURN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  assertTitleOwnsContext(history.frame(), "ATOM NEO · Session / History", "Home / Session");

  const core = await mount();
  await core.press("RETURN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  assertTitleOwnsContext(core.frame(), "ATOM NEO · Session / Core Server", "Home / Session");

  const backup = await mount();
  await backup.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  assertTitleOwnsContext(backup.frame(), "ATOM NEO · Backup", "Home / Backup");

  const configure = await mount({ initialRoute: "configure" });
  assertTitleOwnsContext(configure.frame(), "ATOM NEO · Configure", "Home / Configure");
});

test("gateway shortcut goes through workspace confirmation", async () => {
  const app = await mount();
  await app.press("ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("Gateway configuration uses this workspace.");
  expect(app.frame()).toContain("Continue to Gateway");
  const lines = contentLines(app.frame());
  const title = lines.findIndex(line => line.includes("ATOM NEO · Gateway"));
  expect(lines[title + 1]?.startsWith("workspace:")).toBe(true);
  expect(lines.some(line => line.includes("Home / Gateway"))).toBe(false);
  await app.press("ESCAPE");
  expect(app.frame()).toContain("ATOM NEO · Home");
});

test("top-level Gateway change-workspace shows the parent breadcrumb", async () => {
  const app = await mount();
  await app.press("ARROW_DOWN", "RETURN");
  await app.press("ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("ATOM NEO · Workspace");
  expect(app.frame()).toContain("Home / Gateway / Workspace");
});

test("gateway-real renders Home / Configure / Gateway", async () => {
  const app = await mount({ initialRoute: "gateway" });
  expect(app.frame()).toContain("GATEWAY CLIENTS");
  expect(app.frame()).toContain("Home / Configure / Gateway");
});

test("empty breadcrumb renders workspace directly below the title", async () => {
  const view = await mountNode(
    <MenuChromeProvider version="1.2.3">
      <MenuScreen
        title="Home"
        workspace="/tmp/atom"
        gateway="offline"
        core="online"
        items={[{ key: "back", label: "‹ Back" }]}
        onSelect={() => {}}
        onBack={() => {}}
        hint="Esc back"
      />
    </MenuChromeProvider>,
  );
  const lines = contentLines(view.frame());
  const title = lines.findIndex(line => line.includes("ATOM NEO · Home"));
  expect(lines[title + 1]?.startsWith("workspace:")).toBe(true);
  expect(lines.filter(line => line === "Home")).toHaveLength(0);
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
  expect(unconfigured.frame()).toContain("Gateway / Workspace");
  expect(unconfigured.frame()).toContain("Workspace path");
});

test("gateway shortcut Continue reaches the shared GatewayModal", async () => {
  const app = await mount();
  await app.press("ARROW_DOWN", "RETURN");
  await app.press("RETURN");
  expect(app.frame()).toContain("GATEWAY CLIENTS");
  expect(app.frame()).toContain("Home / Gateway / Configuration");
});

test("atom config opens the flat Configure menu without Advanced", async () => {
  const app = await mount({ initialRoute: "configure" });
  const frame = app.frame();
  expect(frame).toContain("ATOM NEO · Configure");
  expect(frame).toContain("Workspace path");
  expect(frame).toContain("Providers (0)");
  expect(frame).toContain("Model Profiles");
  expect(frame).toContain("Decisions");
  expect(frame).toContain("Theme (edex)");
  expect(frame).toContain("Gateway (clients · port 3000)");
  expect(frame).toContain("Save & Exit");
  expect(frame).not.toContain("Advanced configuration");
  await app.press("ARROW_DOWN");
  expect(app.frame()).toContain("PROVIDERS");
  expect(app.frame()).toContain("No providers configured yet.");
});

test("Configure Providers uses the split list and live provider preview", async () => {
  const app = await mount({ initialRoute: "configure", version: "9.9.9" });
  await app.press("ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("ATOM NEO · Providers & Models");
  expect(app.frame()).toContain("v9.9.9");
  expect(app.frame()).toContain("Home / Configure / Providers & Models");
  expect(app.frame()).toContain("DEEPSEEK");
  expect(app.frame()).toContain("Models");
  await app.press("ESCAPE");
  expect(app.frame()).toContain("ATOM NEO · Configure");
});

test("Configure Add Provider opens an overlay without losing the shell", async () => {
  const app = await mount({ initialRoute: "configure" });
  await app.press("ARROW_DOWN", "RETURN");
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("ADD PROVIDER");
  await app.press("ESCAPE");
  expect(app.frame()).toContain("ATOM NEO · Providers & Models");
  expect(app.frame()).toContain("➕ Add Provider");
});

test("Configure Theme previews real colors before applying", async () => {
  const app = await mount({ initialRoute: "configure" });
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("THEME PREVIEW");
  expect(app.frame()).toContain("Home / Configure / Theme");
  expect(app.frame()).toContain("background  #05090c");
  await app.press("ARROW_DOWN");
  expect(app.frame()).toContain("background  #0d1117");
  await app.press("RETURN");
  expect(app.frame()).toContain("Theme (github-dark)");
});

test("configure Gateway opens the shared GatewayModal", async () => {
  const app = await mount({ initialRoute: "configure" });
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("GATEWAY CLIENTS");
  expect(app.frame()).toContain("Home / Configure / Gateway");
});

function contentLines(frame: string): string[] {
  return frame.split("\n")
    .map(line => line.replace(/[│┌┐└┘─]/g, "").trim())
    .filter(Boolean);
}

function assertFullHeightDivider(frame: string, leftText: string) {
  const lines = frame.split("\n");
  const anchor = lines.find(line => line.includes(leftText));
  expect(anchor).toBeDefined();
  const divider = anchor!.indexOf("│", anchor!.indexOf(leftText) + leftText.length);
  expect(divider).toBeGreaterThan(2);
  const status = lines.findIndex(line => line.includes("Gateway:") && line.includes("Core:"));
  const bodyStart = lines.findIndex(line => line.includes(leftText));
  const hint = lines.findIndex(line => line.includes("Enter open"));
  expect(status).toBeGreaterThan(0);
  expect(bodyStart).toBeGreaterThan(status);
  expect(hint).toBeGreaterThan(bodyStart);
  expect(lines.filter(line => line.includes("Enter open"))).toHaveLength(1);
  // Modal hint owns one padding row above its text; the divider must span the body before it.
  for (let index = bodyStart; index < hint - 1; index++) {
    expect(lines[index]![divider], `divider missing on body row ${index}`).toBe("│");
  }
}

test.each([26, 40])("100-column Home divider spans the full body at %i rows", async (height) => {
  const app = await mount({ height });
  assertFullHeightDivider(app.frame(), "▸ Session");
  expect(app.frame()).toContain("Quit");
});

test.each([26, 40])("100-column Configure divider spans the full body at %i rows", async (height) => {
  const app = await mount({ initialRoute: "configure", height });
  assertFullHeightDivider(app.frame(), "Workspace path");
  expect(app.frame()).toContain("Save & Exit");
  expect(app.frame()).toContain("‹ Back");
});

test("24-row terminal keeps the menu usable", async () => {
  const app = await mount({ height: 24 });
  expect(app.frame()).toContain("ATOM NEO · Home");
  expect(app.frame()).toContain("workspace:");
});

test.each([64, 40])("Home at %i columns has no internal divider", async (width) => {
  const app = await mount({ width });
  const lines = app.frame().split("\n");
  expect(lines.every(line => (line.match(/│/g)?.length ?? 0) <= 2)).toBe(true);
  expect(app.frame()).not.toContain("Chat with the current agent.");
});

// Layout contract: version is rendered muted by MenuScreen's headerRight;
// frame capture verifies placement and single-line behavior.
test.each([100, 64, 40])("top bar keeps title+version on one line at %i columns", async (width) => {
  const app = await mount({ version: "9.9.9", width });
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  const lines = contentLines(app.frame());
  const title = lines.findIndex(line => line.includes("ATOM NEO"));
  expect(title).toBeGreaterThanOrEqual(0);
  expect(lines[title]).toContain("v9.9.9");
  expect(lines[title]!.indexOf("v9.9.9")).toBeGreaterThan(lines[title]!.indexOf("ATOM NEO"));
  expect(lines[title]!.trimEnd().endsWith("v9.9.9")).toBe(true);
  expect(lines.filter(line => line.includes("v9.9.9"))).toHaveLength(1);
  expect(lines[title + 1]).toContain("workspace:");
  expect(lines.filter(line => line.startsWith("workspace:"))).toHaveLength(1);
  expect(lines[title + 2]?.startsWith("Gateway:")).toBe(true);
  expect(lines.some(line => line.includes("Home / Backup"))).toBe(false);
});

test.each([64, 40])("narrow top bar keeps a long CJK workspace on one line at %i columns", async (width) => {
  const workspace = "/Volumes/Projects/很长的项目目录/atom_neo/更深一层/文件";
  const app = await mount({ version: "1.2.3", width, sandbox: workspace });
  await app.press("RETURN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  const lines = contentLines(app.frame());
  const title = lines.findIndex(line => line.includes("ATOM NEO"));
  expect(lines[title]!.trimEnd().endsWith("v1.2.3")).toBe(true);
  expect(lines.filter(line => line.includes("v1.2.3"))).toHaveLength(1);
  expect(lines[title + 1]).toContain("workspace:");
  expect(lines.some(line => line.includes("Home / Session"))).toBe(false);
  const workspaceLines = lines.filter(line => line.startsWith("workspace:"));
  expect(workspaceLines).toHaveLength(1);
  expect(stringWidth(workspaceLines[0]!)).toBeLessThanOrEqual(menuContentWidth(width));
  expect(lines[title + 1]).toBe(workspaceLines[0]!);
  const statusLines = lines.filter(line => line.startsWith("Gateway:"));
  expect(statusLines).toHaveLength(1);
  expect(lines[title + 2]).toBe(statusLines[0]!);
  expect(stringWidth(statusLines[0]!)).toBeLessThanOrEqual(menuContentWidth(width));
});

test("40-column Core Server title has no breadcrumb and keeps workspace/status adjacent", async () => {
  const app = await mount({ version: "9.9.9", width: 40 });
  await app.press("RETURN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  const lines = contentLines(app.frame());
  const title = lines.findIndex(line => line.includes("ATOM NEO"));
  expect(lines.some(line => line.includes("Home / Session"))).toBe(false);
  expect(lines[title + 1]).toContain("workspace:");
  expect(lines.filter(line => line.startsWith("workspace:"))).toHaveLength(1);
  expect(lines[title + 2]?.startsWith("Gateway:")).toBe(true);
  expect(lines.filter(line => line.startsWith("Gateway:"))).toHaveLength(1);
});

test("40-column deep breadcrumb truncates and is followed directly by workspace and status", async () => {
  const breadcrumb = "Home / Configure / Advanced / Providers & Models";
  const view = await mountNode(
    <MenuChromeProvider version="1.2.3" breadcrumb={breadcrumb}>
      <MenuScreen
        title="Advanced"
        workspace="/tmp/atom"
        gateway="offline"
        core="online"
        items={[{ key: "back", label: "‹ Back" }]}
        onSelect={() => {}}
        onBack={() => {}}
        hint="Esc back"
      />
    </MenuChromeProvider>,
  );
  const lines = contentLines(view.frame());
  const title = lines.findIndex(line => line.includes("ATOM NEO · Advanced"));
  const crumb = lines[title + 1]!;
  expect(crumb.startsWith("Home / Configure / Advanced")).toBe(true);
  expect(crumb.endsWith("…")).toBe(true);
  expect(crumb).not.toBe(breadcrumb);
  expect(lines.filter(line => line.includes("Home / Configure / Advanced"))).toHaveLength(1);
  expect(lines[title + 2]?.startsWith("workspace:")).toBe(true);
  expect(lines.filter(line => line.startsWith("workspace:"))).toHaveLength(1);
  expect(lines[title + 3]?.startsWith("Gateway:")).toBe(true);
  expect(lines.filter(line => line.startsWith("Gateway:"))).toHaveLength(1);
});

test("40-column header truncates a long title but keeps the version intact", async () => {
  const app = await mount({ version: "9.9.9", width: 40 });
  await app.press("RETURN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  const lines = contentLines(app.frame());
  const title = lines.findIndex(line => line.includes("ATOM NEO"));
  expect(lines[title]).toContain("…");
  expect(lines[title]).toContain("v9.9.9");
  expect(lines[title]!.indexOf("v9.9.9")).toBeGreaterThan(lines[title]!.indexOf("ATOM NEO"));
  expect(lines[title]!.trimEnd().endsWith("v9.9.9")).toBe(true);
  expect(lines[title + 1]).toContain("workspace:");
  expect(lines.some(line => line.includes("Home / Session"))).toBe(false);
  expect(lines.filter(line => line.startsWith("workspace:"))).toHaveLength(1);
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
  expect(app.frame()).toContain("ATOM NEO · Configure");
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

test("Save & Exit stays on Configure and shows Saved", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "atom-menu-theme-"));
  tempDirs.push(sandbox);
  const app = await mount({
    sandbox,
    initialRoute: "configure",
    actions: actions({ refreshSettings: () => ({ theme: "nord", gatewayPort: 3000 }) }),
  });
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("THEME");
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("ATOM NEO · Configure");
  expect(app.frame()).toContain("Theme (nord)");
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("SAVE & EXIT");
  await app.press("RETURN");
  expect(app.frame()).toContain("ATOM NEO · Configure");
  expect(app.frame()).toContain("Saved");
});

test("Configure workspace editing preserves unsaved wizard state", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "atom-menu-workspace-"));
  tempDirs.push(sandbox);
  const app = await mount({ sandbox, initialRoute: "configure" });
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("Theme (nord)");
  await app.press("RETURN");
  expect(app.frame()).toContain("Configure / Workspace");
  await app.press("ESCAPE");
  expect(app.frame()).toContain("ATOM NEO · Configure");
  expect(app.frame()).toContain("Theme (nord)");
});

function workspaceSandboxes(themeA: string, themeB: string) {
  const a = mkdtempSync(join(tmpdir(), "atom-menu-workspace-a-"));
  const b = mkdtempSync(join(tmpdir(), "atom-menu-workspace-b-"));
  tempDirs.push(a, b);
  writeFileSync(join(a, "config.json"), JSON.stringify({ version: 2, tui: { theme: themeA } }));
  writeFileSync(join(b, "config.json"), JSON.stringify({ version: 2, tui: { theme: themeB } }));
  return { a, b };
}

function workspaceActions(a: string, b: string, themeA: string, themeB: string, overrides: Partial<MenuActions> = {}) {
  let current = a;
  const theme = () => current === b ? themeB : themeA;
  return actions({
    theme: themeA,
    normalizeWorkspace: (path) => path,
    setWorkspace: (path) => { current = path; return path; },
    refreshSettings: () => ({ theme: theme(), gatewayPort: 3000 }),
    ...overrides,
  });
}

function clearInputKeys(value: string): string[] {
  return ["END", ...Array.from({ length: value.length }, () => "BACKSPACE")];
}

test("switching workspace discards unsaved state and reloads the new sandbox", async () => {
  const { a, b } = workspaceSandboxes("github-dark", "nord");
  const app = await mount({ sandbox: a, initialRoute: "configure", actions: workspaceActions(a, b, "github-dark", "nord") });

  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  await app.press("ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("Theme (dracula)");
  await app.press("RETURN");
  await app.press(...clearInputKeys(a));
  await app.type(b);
  await app.press("RETURN");
  expect(app.frame()).toContain("Switch workspace?");
  await app.press("RETURN");
  expect(app.frame()).toContain("Theme (nord)");

  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  await app.press("RETURN");
  expect(app.frame()).toContain("Saved");
  expect(JSON.parse(readFileSync(join(b, "config.json"), "utf8")).tui.theme).toBe("nord");
  expect(JSON.parse(readFileSync(join(a, "config.json"), "utf8")).tui.theme).toBe("github-dark");
});

test("entering the same workspace closes the prompt without reloading state", async () => {
  const { a, b } = workspaceSandboxes("github-dark", "nord");
  const app = await mount({ sandbox: a, initialRoute: "configure", actions: workspaceActions(a, b, "github-dark", "nord") });
  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  await app.press("ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("Theme (dracula)");
  await app.press("RETURN");
  await app.press(...clearInputKeys(a));
  await app.type(a);
  await app.press("RETURN");
  expect(app.frame()).not.toContain("Switch workspace?");
  expect(app.frame()).toContain("Theme (dracula)");
  expect(app.frame()).toContain(a);
});

test("cancelling a workspace switch keeps the old workspace and unsaved state", async () => {
  const { a, b } = workspaceSandboxes("github-dark", "nord");
  const app = await mount({ sandbox: a, initialRoute: "configure", actions: workspaceActions(a, b, "github-dark", "nord") });

  await app.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  await app.press("ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(app.frame()).toContain("Theme (dracula)");
  await app.press("RETURN");
  await app.press(...clearInputKeys(a));
  await app.type(b);
  await app.press("RETURN");
  expect(app.frame()).toContain("Switch workspace?");
  await app.press("ESCAPE");
  expect(app.frame()).toContain("Theme (dracula)");
  expect(app.frame()).toContain(a);
});

test("100-column Configure renders left navigation and right preview across the divider", async () => {
  const app = await mount({ initialRoute: "configure" });
  const line = app.frame().split("\n").find(value => value.includes("Workspace path") && value.includes("WORKSPACE PATH"));
  expect(line).toBeDefined();
  const label = line!.indexOf("Workspace path");
  const divider = line!.indexOf("│", label);
  expect(label).toBeLessThan(divider);
  expect(divider).toBeLessThan(line!.indexOf("WORKSPACE PATH"));
});

test.each([64, 40])("Configure long labels and details never wrap at %i columns", async (width) => {
  const workspace = "/Volumes/Projects/atom_neo/very/long/workspace/path/DO-NOT-WRAP";
  const app = await mount({ initialRoute: "configure", width, sandbox: workspace });
  const lines = contentLines(app.frame());
  expect(lines.filter(line => line.includes("Gateway (clients"))).toHaveLength(1);
  if (width >= 64) expect(lines.some(line => line.includes("Gateway (clients · port 3000)"))).toBe(true);
  expect(lines.some(line => line.trim() === "3000)" || line.trim() === "management")).toBe(false);
  const workspaceRow = lines.findIndex(line => line.includes("Workspace path"));
  expect(workspaceRow).toBeGreaterThanOrEqual(0);
  expect(lines[workspaceRow]).not.toContain("DO-NOT-WRAP");
  expect(lines[workspaceRow + 1]?.startsWith("/Volumes/Projects/atom_neo/very")).toBe(false);
});

test("Configure Escape asks for quit confirmation", async () => {
  const app = await mount({ initialRoute: "configure" });
  await app.press("ESCAPE");
  expect(app.frame()).toContain("QUIT WITHOUT SAVING?");
  await app.press("ESCAPE");
  expect(app.frame()).toContain("ATOM NEO · Configure");
  await app.press("ESCAPE");
  await app.press("ARROW_RIGHT", "RETURN");
  expect(app.frame()).toContain("ATOM NEO · Home");
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
