import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMenuActions } from "./menu-actions";
import { publishRuntimeFile } from "./runtime-file";

const tempDirs: string[] = [];
afterEach(() => { while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true }); });

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "atom-menu-actions-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, ".atom"), { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    providers: {},
    gateway: { port: 3000 },
  }));
  return dir;
}

describe("MenuActions adapter", () => {
  test("validates workspaces and updates gateway port without losing config", () => {
    const dir = sandbox();
    const actions = createMenuActions(dir);
    expect(actions.hasConfig(dir)).toBe(true);
    expect(actions.validateWorkspace(dir)).toBeUndefined();
    expect(actions.validateWorkspace(join(dir, "missing"))).toContain("does not exist");

    actions.setGatewayPort(4123);
    expect(actions.gatewayPort).toBe(4123);
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8"))).toMatchObject({
      providers: {},
      gateway: { port: 4123 },
    });
    expect(statSync(join(dir, "config.json")).mode & 0o777).toBe(0o600);
  });

  test("switches workspace with a normalized path and refreshes settings", () => {
    const first = sandbox();
    const second = sandbox();
    writeFileSync(join(second, "config.json"), JSON.stringify({
      providers: {}, gateway: { port: 4555 }, tui: { theme: "nord" },
    }));
    const actions = createMenuActions(first);
    expect(actions.setWorkspace(second)).toBe(second);
    expect(actions.hasConfig(second)).toBe(true);
    expect(actions.validateWorkspace(second)).toBeUndefined();
    expect(actions.refreshSettings()).toEqual({ theme: "nord", gatewayPort: 4555 });
    expect(() => actions.setWorkspace(join(second, "missing"))).toThrow("does not exist");
    expect(() => actions.setWorkspace("  ")).toThrow("required");
  });

  test("empty directories are read-only and never create config.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "atom-menu-actions-empty-"));
    tempDirs.push(dir);
    const actions = createMenuActions(dir);
    expect(actions.theme).toBe("edex");
    expect(actions.gatewayPort).toBe(3000);
    expect(actions.hasConfig(dir)).toBe(false);
    expect(actions.coreStartTarget()).toEqual({ host: "127.0.0.1", port: 3100 });
    expect(actions.validateWorkspace(dir)).toBeUndefined();
    expect(actions.setWorkspace(dir)).toBe(dir);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });

  test("exports and imports backups through existing backup functions", async () => {
    const source = sandbox();
    writeFileSync(join(source, ".env"), "TOKEN=test\n");
    const archive = join(source, "backup.atombak");
    const actions = createMenuActions(source);
    expect(await actions.exportBackup({ output: archive, password: "secret123" })).toContain("Exported");
    expect(existsSync(archive)).toBe(true);

    const target = sandbox();
    const targetActions = createMenuActions(target);
    expect(await targetActions.importBackup({
      archive, envMode: "replace", password: "secret123",
    })).toContain("Imported");
    expect(readFileSync(join(target, ".env"), "utf8")).toContain("TOKEN=test");
    expect(targetActions.validateBackupPassword("secret")).toBe("Password must be at least 8 characters");
    expect(targetActions.validateBackupPassword("secret123")).toBeUndefined();
    expect(await targetActions.inspectBackup(archive)).toEqual({ encrypted: true });
  });

  test("reads the core target from the runtime file", async () => {
    const dir = sandbox();
    publishRuntimeFile(dir, "core", {
      url: "http://127.0.0.1:4321",
      token: "admin-token",
      instanceId: "core-test",
    });
    expect(await createMenuActions(dir).coreTarget()).toEqual({ host: "127.0.0.1", port: 4321 });
  });
});
