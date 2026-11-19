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

test("export rejects short passwords, masks input, and confirms the password", async () => {
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
  expect(view.frame()).toContain("Password must be at least 8 characters");
  expect(view.frame()).not.toContain("secret");
  await view.type("123");
  await view.press("RETURN");
  await view.type("secret123");
  expect(view.frame()).not.toContain("secret123");
  await view.press("RETURN");
  expect(calls).toEqual([{ output: "dist/backup.atombak", password: "secret123" }]);
});

test("empty export password requires a plaintext warning", async () => {
  const calls: unknown[] = [];
  const view = await mount(
    <BackupExportView
      actions={actions({ exportBackup: async (input) => { calls.push(input); return "exported"; } })}
      title="Backup / Export"
      onDone={() => {}}
      onBack={() => {}}
    />,
  );
  await view.press("RETURN");
  await view.press("RETURN");
  expect(view.frame()).toContain("plaintext API keys");
  expect(calls).toEqual([]);
  await view.press("RETURN");
  expect(calls).toEqual([{ output: undefined, password: undefined }]);
});

test("cancelling the plaintext warning does not export", async () => {
  const calls: unknown[] = [];
  const view = await mount(
    <BackupExportView
      actions={actions({ exportBackup: async (input) => { calls.push(input); return "exported"; } })}
      title="Backup / Export"
      onDone={() => {}}
      onBack={() => {}}
    />,
  );
  await view.press("RETURN");
  await view.press("RETURN");
  await view.press("ESCAPE");
  expect(calls).toEqual([]);
  expect(view.frame()).toContain("Password");
});

test("import asks for a password only for encrypted archives and confirms replacement", async () => {
  const calls: unknown[] = [];
  const view = await mount(
    <BackupImportView
      actions={actions({
        importBackup: async (input) => { calls.push(input); return "imported"; },
        inspectBackup: async () => ({ encrypted: true }),
      })}
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
  expect(view.frame()).toContain("Archive password");
  await view.type("secret123");
  expect(view.frame()).not.toContain("secret123");
  await view.press("RETURN");
  await view.press("ARROW_DOWN", "RETURN");
  expect(view.frame()).toContain("Overwrite config.json/.env");
  await view.press("RETURN");
  expect(calls).toEqual([{ archive: "backup.atombak", envMode: "replace", password: "secret123" }]);
});
