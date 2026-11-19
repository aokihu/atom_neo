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
  { sessionId: "tui-very-long-session-id-for-display", lastTuiUsedAt: 1_760_000_000_000, initiator: { type: "tui" }, status: "suspended", active: false },
  { sessionId: "tui-active", lastTuiUsedAt: 1_760_000_100_000, initiator: { type: "tui" }, status: "active", active: true },
];

function actions(overrides: Partial<MenuActions> = {}): MenuActions {
  return {
    theme: "edex",
    gatewayPort: 3000,
    gateway: { install: async () => "", load: async () => "", pack: async () => "" },
    hasConfig: () => true,
    validateWorkspace: () => undefined,
    setWorkspace: () => {},
    coreStatus: async () => "online",
    coreTarget: async () => ({ host: "127.0.0.1", port: 3100 }),
    gatewayStatus: async () => "offline",
    listSessions: async () => sessions,
    deleteSession: async () => {},
    stopCore: async () => {},
    exportBackup: async () => "",
    importBackup: async () => "",
    setGatewayPort: () => {},
    ...overrides,
  };
}

async function mount(element: ReactNode) {
  const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const setup = await createTestRenderer({ width: 100, height: 32 });
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

test("history lists sessions and deletes through MenuActions", async () => {
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
  expect(view.frame()).toContain("tui-active");
  expect(view.frame()).toContain("active");
  await view.press("DELETE");
  expect(deleted).toEqual([sessions[0]!.sessionId]);
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
      actions={actions({ stopCore: async () => { stopped++; } })}
      onLaunch={(launch) => launches.push(launch)}
      onBack={() => {}}
      onRefreshStatus={() => {}}
    />,
  );
  await view.press("ARROW_DOWN", "RETURN");
  expect(stopped).toBe(1);
  await view.press("ARROW_UP", "ARROW_DOWN", "ARROW_DOWN", "RETURN");
  expect(launches).toEqual([{ kind: "attach", sandbox: "/tmp/atom", host: "127.0.0.1", port: 3100 }]);
});
