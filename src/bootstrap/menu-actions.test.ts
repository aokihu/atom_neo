import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  });

  test("switches workspace and updates gateway actions", () => {
    const first = sandbox();
    const second = sandbox();
    const actions = createMenuActions(first);
    actions.setWorkspace(second);
    expect(actions.hasConfig(second)).toBe(true);
    expect(actions.validateWorkspace(second)).toBeUndefined();
  });

  test("exports and imports backups through existing backup functions", async () => {
    const source = sandbox();
    writeFileSync(join(source, ".env"), "TOKEN=test\n");
    const archive = join(source, "backup.atombak");
    const actions = createMenuActions(source);
    expect(await actions.exportBackup({ output: archive, password: "secret" })).toContain("Exported");
    expect(existsSync(archive)).toBe(true);

    const target = sandbox();
    const targetActions = createMenuActions(target);
    expect(await targetActions.importBackup({
      archive, envMode: "replace", password: "secret", force: true,
    })).toContain("Imported");
    expect(readFileSync(join(target, ".env"), "utf8")).toContain("TOKEN=test");
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
