// History tests never touch the real user configuration directory.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { readMenuHistory, saveMenuHistory } from "./menu-history";

const folders: string[] = [];
function historyPath() {
  const folder = mkdtempSync(join(tmpdir(), "atom-menu-history-"));
  folders.push(folder);
  return join(folder, "atom", "menu_history.json");
}
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

test("reading absent history does not create directories", () => {
  const path = historyPath();
  expect(readMenuHistory(path)).toEqual({ commands: {} });
  expect(existsSync(dirname(path))).toBe(false);
});

test("remembers each action independently and strips credentials and unrelated fields", () => {
  const path = historyPath();
  saveMenuHistory("attach", { coreServer: "192.168.1.20", corePort: 3100, sandbox: "/unrelated", ...{ token: "secret", apiKey: "secret" } }, path);
  saveMenuHistory("config", { sandbox: "/my project" }, path);
  saveMenuHistory("gateway-start", { sandbox: "/my project", clients: "telegram" }, path);
  saveMenuHistory("gateway-start", { sandbox: "/my project" }, path);
  expect(readMenuHistory(path).commands).toEqual({
    attach: { coreServer: "192.168.1.20", corePort: 3100 }, config: { sandbox: "/my project" },
    "gateway-start": { sandbox: "/my project" },
  });
  expect(readFileSync(path, "utf8")).not.toContain("secret");
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readdirSync(dirname(path))).toEqual(["menu_history.json"]);
});

test("remembers backup paths and encryption choice without secrets", () => {
  const path = historyPath();
  saveMenuHistory("export", { sandbox: "/my project", output: "/tmp/backup.atombak", encrypt: true }, path);
  saveMenuHistory("import", { sandbox: "/my project", archive: "/tmp/backup.atombak" }, path);
  expect(readMenuHistory(path).commands).toEqual({
    export: { sandbox: "/my project", output: "/tmp/backup.atombak", encrypt: true },
    import: { archive: "/tmp/backup.atombak", sandbox: "/my project" },
  });
  expect(readFileSync(path, "utf8")).not.toContain("password");
});

test("remembers gateway packaging parameters and never stores secret-like fields", () => {
  const path = historyPath();
  saveMenuHistory("gateway-install", { sandbox: "/s", target: "/tmp/bot.tar.gz" }, path);
  saveMenuHistory("gateway-load", { sandbox: "/s", target: "/clients/bot", id: "bot-dev" }, path);
  saveMenuHistory("gateway-manage", { sandbox: "/s", target: "/ignored", id: "ignored", out: "/ignored" }, path);
  saveMenuHistory("gateway-pack", { sandbox: "/s", target: "/clients/bot", out: "/tmp/dist/bot.tar.gz" }, path);
  saveMenuHistory("gateway-load", { sandbox: "/s", target: "/clients/bot", ...{ token: "admin-secret", secret: "hunter2" } }, path);
  expect(readMenuHistory(path).commands).toEqual({
    "gateway-install": { sandbox: "/s", target: "/tmp/bot.tar.gz" },
    "gateway-load": { sandbox: "/s", target: "/clients/bot" },
    "gateway-manage": { sandbox: "/s" },
    "gateway-pack": { sandbox: "/s", target: "/clients/bot", out: "/tmp/dist/bot.tar.gz" },
  });
  const text = readFileSync(path, "utf8");
  expect(text).not.toContain("admin-secret");
  expect(text).not.toContain("hunter2");
});

test("reading gateway history drops secret-like fields", () => {
  const path = historyPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    version: 1,
    commands: { "gateway-load": { sandbox: "/s", target: "/clients/bot", id: "bot-dev", token: "admin-secret", secret: "hunter2" } },
  }));
  expect(readMenuHistory(path).commands).toEqual({ "gateway-load": { sandbox: "/s", target: "/clients/bot", id: "bot-dev" } });
});

test("warns for malformed or incompatible history and recovers on successful save", () => {
  const path = historyPath();
  saveMenuHistory("config", { sandbox: "/valid" }, path);
  for (const text of ["{bad", JSON.stringify({ version: 2, commands: {} }), JSON.stringify({ version: 1, commands: { attach: { corePort: 99999 } } })]) {
    writeFileSync(path, text);
    expect(readMenuHistory(path)).toMatchObject({ commands: {}, warning: expect.any(String) });
  }
  saveMenuHistory("attach", { coreServer: "localhost", corePort: 1 }, path);
  expect(readMenuHistory(path)).toEqual({ commands: { attach: { coreServer: "localhost", corePort: 1 } } });
});
