import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import { BackupExportView, BackupImportView, BackupView } from "./backup-view";
import type { MenuActions } from "./menu-types";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length > 0) await cleanup.pop()!(); });

function actions(overrides: Partial<MenuActions> = {}): MenuActions {
  return {
    theme: "edex",
    gatewayPort: 3000,
    gateway: { install: async () => "", load: async () => "", pack: async () => "" },
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
    for (let index = 0; index < 5; index++) {
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
    await setup.renderOnce();
  };
  return { press, type, frame: setup.captureCharFrame };
}

test("backup home keeps Export before Import", async () => {
  const view = await mount(
    <BackupView workspace="/tmp/atom" gateway="offline" core="offline" onExport={() => {}} onImport={() => {}} onBack={() => {}} />,
  );
  expect(view.frame()).toContain("Export");
  expect(view.frame()).toContain("Import");
  expect(view.frame().indexOf("Export")).toBeLessThan(view.frame().indexOf("Import"));
});

test("export collects output and password then invokes the backup action", async () => {
  const calls: unknown[] = [];
  const view = await mount(
    <BackupExportView
      actions={actions({ exportBackup: async (input) => { calls.push(input); return "exported"; } })}
      title="Backup / Export"
      onDone={() => {}}
      onBack={() => {}}
    />,
  );
  await view.type("dist/backup.atombak");
  await view.press("RETURN");
  await view.type("secret");
  await view.press("RETURN");
  expect(calls).toEqual([{ output: "dist/backup.atombak", password: "secret" }]);
});

test("import collects archive, env mode, confirmation and invokes the backup action", async () => {
  const calls: unknown[] = [];
  const view = await mount(
    <BackupImportView
      actions={actions({ importBackup: async (input) => { calls.push(input); return "imported"; } })}
      workspace="/tmp/atom"
      gateway="offline"
      core="offline"
      title="Backup / Import"
      onDone={() => {}}
      onBack={() => {}}
    />,
  );
  await view.type("backup.atombak");
  await view.press("RETURN");
  await view.press("RETURN");
  await view.press("ARROW_DOWN", "RETURN");
  expect(view.frame()).toContain("Overwrite config.json/.env");
  await view.press("RETURN");
  expect(calls).toEqual([{ archive: "backup.atombak", envMode: "replace", password: undefined, force: true }]);
});
