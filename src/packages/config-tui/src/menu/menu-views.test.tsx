import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { HistoryView } from "./history-view";
import { CoreServerView } from "./core-server-view";
import type { MenuActions, MenuLaunch, SessionSummary } from "./menu-types";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length > 0) await cleanup.pop()!(); });

const sessions: SessionSummary[] = [
  { sessionId: "tui-very-long-session-id-for-display", lastTuiUsedAt: 1_760_000_000_000, initiator: { type: "tui" }, status: "suspended", active: false, attached: false },
  { sessionId: "tui-attached", lastTuiUsedAt: 1_760_000_100_000, initiator: { type: "tui" }, status: "suspended", active: false, attached: true },
  { sessionId: "tui-active", lastTuiUsedAt: 1_760_000_200_000, initiator: { type: "tui" }, status: "active", active: true, attached: false },
];

function actions(overrides: Partial<MenuActions> = {}): MenuActions {
  return {
    theme: "edex",
    gatewayPort: 3000,
    gateway: { install: async () => "", load: async () => "", pack: async () => "" },
    hasConfig: () => true,
    validateWorkspace: () => undefined,
    setWorkspace: (path) => path,
    refreshSettings: () => ({ theme: "edex", gatewayPort: 3000 }),
    coreStatus: async () => "online",
    coreTarget: async () => ({ host: "127.0.0.1", port: 3100 }),
    coreStartTarget: () => ({ host: "127.0.0.1", port: 3100 }),
    gatewayStatus: async () => "offline",
    listSessions: async () => sessions,
    deleteSession: async () => {},
    stopCore: async () => {},
    exportBackup: async () => "",
    importBackup: async () => "",
    validateBackupPassword: (password) => password.length < 8 ? "Password must be at least 8 characters" : undefined,
    inspectBackup: async () => ({ encrypted: false }),
    setGatewayPort: () => {},
    ...overrides,
  };
}

async function mount(element: ReactNode, options: { width?: number; height?: number } = {}) {
  const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const setup = await createTestRenderer({ width: options.width ?? 100, height: options.height ?? 32 });
  const root = createRoot(setup.renderer);
  await act(async () => root.render(element));
  await settle();
  cleanup.push(async () => {
    await act(async () => root.unmount());
    setup.renderer.destroy();
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
  });
  async function settle() {
    for (let index = 0; index < 6; index++) {
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
  return { press, frame: setup.captureCharFrame };
}

test("history lists sessions and deletes through MenuActions without opening or going back", async () => {
  const deleted: string[] = [];
  let opened = 0;
  let backs = 0;
  const view = await mount(
    <HistoryView
      workspace="/tmp/atom"
      gateway="offline"
      core="online"
      actions={actions({ deleteSession: async (id) => { deleted.push(id); } })}
      onBack={() => { backs++; }}
      onOpen={() => { opened++; }}
      onRefreshStatus={() => {}}
    />,
  );
  expect(view.frame()).toContain("tui-active");
  expect(view.frame()).toContain("active");
  await view.press("DELETE");
  expect(view.frame()).toContain("Delete session");
  await view.press("RETURN");
  expect(deleted).toEqual([sessions[0]!.sessionId]);
  expect(opened).toBe(0);
  expect(backs).toBe(0);
});

test("history delete confirmation cancels without deleting or going back", async () => {
  const deleted: string[] = [];
  let opened = 0;
  let backs = 0;
  const view = await mount(
    <HistoryView
      workspace="/tmp/atom"
      gateway="offline"
      core="online"
      actions={actions({ deleteSession: async (id) => { deleted.push(id); } })}
      onBack={() => { backs++; }}
      onOpen={() => { opened++; }}
      onRefreshStatus={() => {}}
    />,
  );
  await view.press("DELETE");
  await view.press("ESCAPE");
  expect(deleted).toEqual([]);
  expect(opened).toBe(0);
  expect(backs).toBe(0);
  expect(view.frame()).not.toContain("Delete session");
});

test("active or attached sessions are not deletable", async () => {
  const deleted: string[] = [];
  const view = await mount(
    <HistoryView
      workspace="/tmp/atom"
      gateway="offline"
      core="online"
      actions={actions({ deleteSession: async (id) => { deleted.push(id); } })}
      onBack={() => {}}
      onOpen={() => {}}
      onRefreshStatus={() => {}}
    />,
  );
  await view.press("ARROW_DOWN", "DELETE");
  expect(view.frame()).toContain("Cannot delete attached session");
  expect(deleted).toEqual([]);
  await view.press("ARROW_DOWN", "DELETE");
  expect(view.frame()).toContain("Cannot delete active session");
  expect(deleted).toEqual([]);
});

test("history shows an unavailable state when Core is offline", async () => {
  const view = await mount(
    <HistoryView
      workspace="/tmp/atom"
      gateway="offline"
      core="offline"
      actions={actions()}
      onBack={() => {}}
      onOpen={() => {}}
      onRefreshStatus={() => {}}
    />,
  );
  expect(view.frame()).toContain("Core is offline");
  expect(view.frame()).not.toContain("tui-active");
});

test("long history lists keep the selection visible", async () => {
  const many: SessionSummary[] = Array.from({ length: 30 }, (_, index) => ({
    sessionId: `session-${String(index).padStart(2, "0")}`,
    lastTuiUsedAt: 1_760_000_000_000 - index,
    initiator: { type: "tui" },
    status: "suspended",
    active: false,
    attached: false,
  }));
  const view = await mount(
    <HistoryView
      workspace="/tmp/atom"
      gateway="offline"
      core="online"
      actions={actions({ listSessions: async () => many })}
      onBack={() => {}}
      onOpen={() => {}}
      onRefreshStatus={() => {}}
    />,
  );
  for (let index = 0; index < 20; index++) await view.press("ARROW_DOWN");
  expect(view.frame()).toContain("session-20");
  expect(view.frame()).toContain("12-21 of 32");
  expect(view.frame()).not.toContain("session-00");
});

test("narrow layouts truncate long workspace paths", async () => {
  const workspace = "/Volumes/Projects/atom_neo/very/long/workspace/path/that/does/not/fit";
  const view = await mount(
    <HistoryView
      workspace={workspace}
      gateway="offline"
      core="online"
      actions={actions({ listSessions: async () => [] })}
      onBack={() => {}}
      onOpen={() => {}}
      onRefreshStatus={() => {}}
    />,
    { width: 64, height: 24 },
  );
  expect(view.frame()).toContain("…");
  expect(view.frame()).not.toContain(workspace);
});

test("history opens a selected session with its Core target", async () => {
  const opened: string[] = [];
  const view = await mount(
    <HistoryView
      workspace="/tmp/atom"
      gateway="offline"
      core="online"
      actions={actions()}
      onBack={() => {}}
      onOpen={(id) => opened.push(id)}
      onRefreshStatus={() => {}}
    />,
  );
  await view.press("RETURN");
  expect(opened).toEqual([sessions[0]!.sessionId]);
});

test("core server stop uses the controlled action and attach returns a launch", async () => {
  let stopped = 0;
  const launches: MenuLaunch[] = [];
  const view = await mount(
    <CoreServerView
      workspace="/tmp/atom"
      gateway="offline"
      core="online"
      actions={actions({
        stopCore: async () => { stopped++; },
        coreStatus: async () => stopped > 0 ? "offline" : "online",
      })}
      onLaunch={(launch) => launches.push(launch)}
      onBack={() => {}}
      onRefreshStatus={() => {}}
    />,
  );
  await view.press("ARROW_DOWN", "RETURN");
  expect(stopped).toBe(1);
  expect(view.frame()).toContain("Core stopped");
  await view.press("ARROW_UP", "RETURN");
  expect(launches).toEqual([{ kind: "core", sandbox: "/tmp/atom", host: "127.0.0.1", port: 3100 }]);
  await view.press("ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(launches[1]).toEqual({ kind: "attach", sandbox: "/tmp/atom", host: "127.0.0.1", port: 3100 });
});
