// Exercise complete user paths and their shared CLI launch arguments.
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseArguments } from "./cli";
import { formatMenuCommand, MenuFlow, parseServerHost, type MenuRequest } from "./menu-flow";
import type { MenuHistory } from "./menu-history";

function flow(history: MenuHistory = {}, argv: string[] = []) {
  const base = parseArguments(["menu", ...argv]);
  if (base === "help") throw new Error("Unexpected help");
  return new MenuFlow(base, history);
}
function choose(menu: MenuFlow, index: number) { menu.selected = index; return menu.submit(); }
function completed(value: ReturnType<MenuFlow["submit"]>): MenuRequest {
  if (!value || value === "exit") throw new Error("Expected launch request");
  return value;
}

test("attach is address then port and automatically produces the TUI request", () => {
  const menu = flow({ attach: { coreServer: "10.0.0.5", corePort: 4200 } });
  choose(menu, 3);
  expect(menu.view()).toMatchObject({ field: "coreServer", value: "10.0.0.5" });
  menu.submit("core.example.com");
  expect(menu.view()).toMatchObject({ field: "corePort", value: "4200" });
  const request = completed(menu.submit());
  expect(request.args).toMatchObject({ menu: false, mode: "tui", coreServer: "core.example.com", corePort: 4200, config: false, continueSession: false });
  expect(request.parameters).toEqual({ coreServer: "core.example.com", corePort: 4200 });
  expect(menu.view().field).toBe("corePort");
});

test("back preserves edits, invalid inputs stay on their field, and retries reuse the final draft", () => {
  const menu = flow();
  choose(menu, 3);
  menu.submit("10.0.0.8");
  menu.setValue("99999");
  expect(() => menu.submit()).toThrow("Invalid port");
  expect(menu.view()).toMatchObject({ field: "corePort", value: "99999" });
  menu.back();
  expect(menu.view()).toMatchObject({ field: "coreServer", value: "10.0.0.8" });
  menu.submit();
  expect(menu.view().value).toBe("99999");
  const first = completed(menu.submit("3100"));
  menu.error = "connection refused";
  expect(completed(menu.submit())).toEqual(first);
  menu.back(); menu.back();
  choose(menu, 3);
  expect(menu.view().value).toBe("10.0.0.8");
});

test("config uses remembered sandbox unless the invocation explicitly overrides it", () => {
  for (const [argv, expected] of [[[], "/remembered"], [["--sandbox", "/explicit"], "/explicit"]] as const) {
    const menu = flow({ config: { sandbox: "/remembered" } }, [...argv]);
    choose(menu, 1);
    expect(menu.view().value).toBe(expected);
    expect(completed(menu.submit()).args).toMatchObject({ config: true, sandbox: expected, mode: undefined });
  }
});

test("chat remembers session choice and immediately launches after selecting it", () => {
  const menu = flow({ chat: { sandbox: "/chat", continueSession: true } });
  choose(menu, 0); choose(menu, 0); menu.submit();
  expect(menu.selected).toBe(1);
  const request = completed(menu.submit());
  expect(request.args).toMatchObject({ sandbox: "/chat", mode: undefined, config: false, continueSession: true });
});

test.each(["core", "core-gateway"] as const)("launches %s only after all listening parameters", command => {
  const menu = flow();
  choose(menu, command === "core" ? 0 : 2);
  choose(menu, command === "core" ? 1 : 0);
  menu.submit("/a project"); menu.submit("0.0.0.0");
  const request = completed(menu.submit("0"));
  expect(request.args).toMatchObject({ sandbox: "/a project", mode: command, host: "0.0.0.0", port: 0 });
});

test.each([1, 2])("gateway action %i preserves single-client and all semantics", index => {
  const menu = flow();
  choose(menu, 2); choose(menu, index); menu.submit("/gateway");
  expect(completed(menu.submit("telegram")).args).toMatchObject({ mode: "gateway", action: index === 1 ? "start" : "stop", clients: "telegram" });
  expect(completed(menu.submit("all")).args.clients).toBeUndefined();
  expect(completed(menu.submit("")).parameters.clients).toBeUndefined();
});

test("root cancellation and exit do not produce a launch request", () => {
  const menu = flow();
  expect(menu.back()).toBe(false);
  expect(choose(menu, 5)).toBe("exit");
});

test("backup export wizard collects path and encryption choice", () => {
  const menu = flow({ export: { sandbox: "/saved", output: "/tmp/old.atombak", encrypt: false } });
  choose(menu, 4); choose(menu, 0);
  expect(menu.view()).toMatchObject({ title: "menu / backup / export", field: "sandbox", value: "/saved" });
  menu.submit("/project");
  expect(menu.view()).toMatchObject({ field: "output", value: "/tmp/old.atombak" });
  menu.submit("/tmp/new.atombak");
  expect(menu.view()).toMatchObject({ field: "encrypt", value: "no", items: ["yes", "no", "‹ back"] });
  const request = completed(menu.submit());
  expect(request.args).toMatchObject({ command: "export", sandbox: resolve("/project"), output: "/tmp/new.atombak", password: false, menu: false });
  expect(request.parameters).toEqual({ sandbox: resolve("/project"), output: "/tmp/new.atombak", encrypt: false });
});

test("backup export defaults to encryption and leaves output empty", () => {
  const menu = flow();
  choose(menu, 4); choose(menu, 0);
  menu.submit("/project"); menu.submit();
  expect(menu.view()).toMatchObject({ field: "encrypt", value: "yes" });
  const request = completed(menu.submit());
  expect(request.args).toMatchObject({ command: "export", password: true });
  expect(request.args.output).toBeUndefined();
  expect(request.parameters).toEqual({ sandbox: resolve("/project"), encrypt: true });
});

test("backup import wizard reuses archive and never asks for a password flag", () => {
  const menu = flow({ import: { archive: "/tmp/backup.atombak", sandbox: "/saved" } });
  choose(menu, 4); choose(menu, 1);
  expect(menu.view()).toMatchObject({ title: "menu / backup / import", field: "archive", value: "/tmp/backup.atombak" });
  menu.submit();
  expect(menu.view()).toMatchObject({ field: "sandbox", value: "/saved" });
  const request = completed(menu.submit());
  expect(request.args).toMatchObject({ command: "import", archive: "/tmp/backup.atombak", sandbox: resolve("/saved"), password: false, menu: false });
  expect(request.parameters).toEqual({ archive: "/tmp/backup.atombak", sandbox: resolve("/saved") });
});

test("backup import requires a non-empty archive path", () => {
  const menu = flow();
  choose(menu, 4); choose(menu, 1);
  expect(() => menu.submit("")).toThrow("请填写归档文件路径");
  expect(menu.view().field).toBe("archive");
});

test("returning to a parent restores the entry that opened the child", () => {
  const menu = flow();
  choose(menu, 2); choose(menu, 2);
  expect(menu.view()).toMatchObject({ title: "menu / gateway / stop clients", step: 1, total: 2 });
  menu.back();
  expect(menu.page).toBe("gateway");
  expect(menu.selected).toBe(2);
  menu.back();
  expect(menu.page).toBe("menu");
  expect(menu.selected).toBe(2);
  choose(menu, 0); choose(menu, 1);
  menu.back();
  expect(menu.page).toBe("start");
  expect(menu.selected).toBe(1);
});

test("back entries navigate without executing, including the final session step", () => {
  const menu = flow({ chat: { continueSession: true } });
  choose(menu, 2);
  expect(choose(menu, 3)).toBeUndefined();
  expect(menu.page).toBe("menu");
  choose(menu, 0); choose(menu, 0); menu.submit();
  expect(menu.view()).toMatchObject({ title: "menu / start / chat", items: ["new", "continue", "‹ back"], step: 2, total: 2 });
  expect(choose(menu, 2)).toBeUndefined();
  expect(menu.view().field).toBe("sandbox");
  menu.submit();
  expect(menu.selected).toBe(1);
});

test("progress and breadcrumbs stay within the selected startup path", () => {
  const menu = flow();
  choose(menu, 2); choose(menu, 0);
  expect(menu.view()).toMatchObject({ title: "menu / gateway / run", step: 1, total: 3 });
  menu.submit(); menu.submit();
  expect(menu.view()).toMatchObject({ title: "menu / gateway / run", step: 3, total: 3, field: "port" });
  menu.back();
  expect(menu.view()).toMatchObject({ step: 2, total: 3, field: "host" });
});

test.each(["http://host", "host:3100", "host/path", "", "bad host", "user@host"])("rejects non-host address %s", value => {
  expect(() => parseServerHost(value)).toThrow();
});
test.each(["127.0.0.1", "example.com", "::1", "[::1]"])("accepts address %s", value => {
  expect(parseServerHost(value)).toBe(value.replace(/[\[\]]/g, ""));
});

test.each([
  [], ["--continue"], ["--config"], ["--mode", "core", "--host", "0.0.0.0", "--port", "0"],
  ["--mode", "core-gateway", "--port", "4100"],
  ["--mode", "tui", "--core-server", "::1", "--core-port", "4200"],
  ["--mode", "gateway", "--action", "start"],
  ["--mode", "gateway", "--action", "stop", "--clients", "telegram's $(printf BAD)"],
  ["export", "--output", "backup.atombak", "--password"],
  ["import", "backup.atombak"],
].map(argv => ({ argv })))("printed command preserves CLI behavior and literal shell arguments: $argv", ({ argv }) => {
  const args = parseArguments([...argv, "--sandbox", "/tmp/项目 O'Brien $(printf BAD); $HOME"]);
  if (args === "help") throw new Error("Unexpected help");
  const printed = formatMenuCommand(args, ["printf", "%s\\n"]);
  const shell = Bun.spawnSync(["/bin/sh", "-c", printed]);
  expect(shell.exitCode).toBe(0);
  expect(parseArguments(shell.stdout.toString().trimEnd().split("\n"))).toEqual(args);
});
