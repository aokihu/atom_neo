import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { applicationCommandName, buildAppCommand, parseArguments } from "./cli";

describe("menu command", () => {
  test("accepts the command and optional sandbox", () => {
    expect(parseArguments(["menu"])).toMatchObject({ menu: true, sandboxExplicit: false });
    expect(parseArguments(["menu", "--sandbox", "./project"])).toMatchObject({ menu: true, sandboxExplicit: true, sandbox: resolve("project") });
    expect(parseArguments(["menu", "--help"])).toBe("help");
    expect(parseArguments([])).toMatchObject({ menu: false });
  });

  test.each([["menu", "--config"], ["menu", "--mode", "core"], ["menu", "--port", "0"],
    ["menu", "--wizard"], ["menu", "--continue"], ["menu", "attach"], ["unknown"], ["--sandbox", ".", "menu"]].map(args => ({ args })))("rejects ambiguous invocation $args", ({ args }) => {
    expect(() => parseArguments(args)).toThrow();
  });
});

describe("export / import commands", () => {
  test("parses export options", () => {
    const args = parseArguments(["export", "--sandbox", "./project", "-o", "backup.atombak", "--password"]) as any;
    expect(args).toMatchObject({ command: "export", sandbox: resolve("project"), output: "backup.atombak", password: true, force: false });
  });

  test("parses import options and resolves the archive path", () => {
    const args = parseArguments(["import", "backup.atombak", "--sandbox", "./project", "--env", "replace", "--dry-run", "--force"]) as any;
    expect(args).toMatchObject({ command: "import", archive: resolve("backup.atombak"), sandbox: resolve("project"), envMode: "replace", dryRun: true, force: true });
    expect(parseArguments(["import", "backup.atombak"])).toMatchObject({ envMode: "merge", password: false });
  });

  test("rejects invalid invocations", () => {
    expect(() => parseArguments(["export", "--mode", "core"])).toThrow("export does not accept --mode");
    expect(() => parseArguments(["export", "extra"])).toThrow();
    expect(() => parseArguments(["import"])).toThrow("exactly one archive path");
    expect(() => parseArguments(["import", "a.atombak", "b.atombak"])).toThrow("exactly one archive path");
    expect(() => parseArguments(["import", "a.atombak", "--env", "bad"])).toThrow("Invalid --env");
    expect(() => parseArguments(["import", "a.atombak", "--output", "x"])).toThrow("import does not accept --output");
    expect(() => parseArguments(["--force"])).toThrow("require export or import");
  });

  test("shows help for subcommands", () => {
    expect(parseArguments(["export", "--help"])).toBe("help");
    expect(parseArguments(["import", "--help"])).toBe("help");
  });
});

describe("parseArguments --wizard", () => {
  test("defaults to false", () => {
    const args = parseArguments(["--sandbox", "/tmp/sb"]) as any;
    expect(args.wizard).toBe(false);
  });

  test("detects the --wizard flag", () => {
    const args = parseArguments(["--wizard", "--sandbox", "/tmp/sb"]) as any;
    expect(args.wizard).toBe(true);
  });
});

describe("config subcommand", () => {
  test("routes atom config and atom config gateway", () => {
    expect(parseArguments(["config", "--sandbox", "/tmp/sb"])).toMatchObject({
      configRoute: "configure",
      sandbox: "/tmp/sb",
      sandboxExplicit: true,
    });
    expect(parseArguments(["config", "gateway", "--sandbox", "/tmp/sb"])).toMatchObject({
      configRoute: "gateway",
      sandbox: "/tmp/sb",
    });
    expect(parseArguments(["config"])).toMatchObject({ configRoute: "configure" });
    expect(parseArguments(["config", "--help"])).toBe("help");
  });

  test("rejects old --config/--gateway flags and invalid config targets", () => {
    expect(() => parseArguments(["--config"])).toThrow("Unknown option '--config'");
    expect(() => parseArguments(["--config", "--gateway"])).toThrow("Unknown option '--config'");
    expect(() => parseArguments(["--gateway"])).toThrow("Unknown option '--gateway'");
    expect(() => parseArguments(["config", "providers"])).toThrow("Unknown config target: providers");
    expect(() => parseArguments(["config", "gateway", "extra"])).toThrow("config accepts only an optional 'gateway' target");
    expect(() => parseArguments(["config", "--mode", "core"])).toThrow("Invalid config command: Unknown option '--mode'");
  });
});

describe("parseArguments sandbox paths", () => {
  test.each([
    [["--sandbox=~/warehouse"], resolve(homedir(), "warehouse")],
    [["--sandbox", "~/warehouse"], resolve(homedir(), "warehouse")],
    [["--sandbox=~"], homedir()],
    [["--sandbox", "~/my warehouse"], resolve(homedir(), "my warehouse")],
    [["--sandbox=./warehouse"], resolve("warehouse")],
    [["--sandbox=/Volumes/Projects/atom_sandbox"], "/Volumes/Projects/atom_sandbox"],
    [[], process.cwd()],
  ] as [string[], string][])("resolves %j", (input, expected) => {
    const args = parseArguments(input);
    if (args === "help") throw new Error("Unexpected help");
    expect(args.sandbox).toBe(expected);
  });
  test("rejects an empty sandbox", () => {
    expect(() => parseArguments(["--sandbox="])).toThrow("--sandbox cannot be empty");
  });
});


describe("application command", () => {
  test("Bun source runs the entrypoint with run", () => {
    expect(buildAppCommand(["--wizard"], "/repo/src/main.ts", "/usr/bin/bun", "bun"))
      .toEqual(["/usr/bin/bun", "run", "/repo/src/main.ts", "--wizard"]);
  });

  test("compiled Bun invokes the executable directly", () => {
    expect(buildAppCommand(["--wizard"], null, "/repo/dist/atom", "bun"))
      .toEqual(["/repo/dist/atom", "--wizard"]);
  });

  test("Node invokes the entrypoint directly", () => {
    expect(buildAppCommand(["--wizard"], "/repo/src/main.ts", "/usr/bin/node", "node"))
      .toEqual(["/usr/bin/node", "/repo/src/main.ts", "--wizard"]);
  });

  test("help names the compiled binary atom and shows source commands", () => {
    expect(applicationCommandName("bun", null, "/repo/dist/atom", "/repo")).toBe("atom");
    expect(applicationCommandName("bun", "/repo/src/main.ts", "/usr/bin/bun", "/repo")).toBe("bun run src/main.ts");
    expect(applicationCommandName("node", "/repo/dist/node/main.js", "/usr/bin/node", "/repo")).toBe("node dist/node/main.js");
  });
});

describe("parseArguments session continuation", () => {
  test.each([{ args: [], expected: false }, { args: ["-c"], expected: true }, { args: ["--continue"], expected: true },
    { args: ["--mode", "tui", "--core-server", "localhost", "--core-port", "3100", "-c"], expected: true }])("parses $args", ({ args, expected }) => {
    const parsed = parseArguments(args);
    if (parsed === "help") throw new Error("Unexpected help");
    expect(parsed.continueSession).toBe(expected);
  });
});

describe("gateway command", () => {
  const actions = [
    "install", "upgrade", "load", "reload", "list", "start", "stop", "check", "logs", "pack", "uninstall",
  ] as const;
  const targetActions = actions.filter(action => action !== "list");

  function bootArgs(args: string[]) {
    const parsed = parseArguments(args);
    if (parsed === "help") throw new Error("Unexpected help");
    return parsed;
  }

  test("parses every action with a target where required", () => {
    for (const action of actions) {
      const target = action === "list" ? undefined : "bot";
      const args = bootArgs(["gateway", action, ...(target ? [target] : [])]);
      expect(args.gatewayCommand).toMatchObject({ action, target, force: false, json: false });
      expect(args).toMatchObject({
        menu: false, wizard: false, password: false, dryRun: false, envMode: "merge",
        sandboxExplicit: false, port: 3100, host: "127.0.0.1", sandbox: process.cwd(),
        logLevel: "debug", logIgnore: [], logLevelExplicit: false, logIgnoreExplicit: false,
        logModes: [], continueSession: false,
      });
      expect(args.mode).toBeUndefined();
      expect(args.action).toBeUndefined();
      expect(args.clients).toBeUndefined();
    }
  });

  test("enforces target requirements", () => {
    expect(() => parseArguments(["gateway", "list", "bot"])).toThrow("gateway list does not accept a target");
    for (const action of targetActions) {
      expect(() => parseArguments(["gateway", action])).toThrow(`gateway ${action} requires a target`);
    }
  });

  test("pack accepts --out, --target, --force and --json", () => {
    const args = bootArgs(["gateway", "pack", "bot", "--out", "bot.atompkg", "--target", "linux-x64", "--force", "--json"]);
    expect(args.gatewayCommand).toEqual({
      action: "pack", target: "bot", out: "bot.atompkg", targetPlatform: "linux-x64", force: true, json: true,
    });
    expect(bootArgs(["gateway", "pack", "bot"]).gatewayCommand).toMatchObject({ out: undefined, targetPlatform: undefined });
    expect(() => parseArguments(["gateway", "pack", "bot", "--out="])).toThrow("--out cannot be empty");
    expect(() => parseArguments(["gateway", "pack", "bot", "--target="])).toThrow("--target cannot be empty");
  });

  test("load accepts --id and other actions reject it", () => {
    expect(bootArgs(["gateway", "load", "clients/bot", "--id", "bot-dev"]).gatewayCommand)
      .toMatchObject({ action: "load", target: "clients/bot", id: "bot-dev" });
    expect(() => parseArguments(["gateway", "load", "clients/bot", "--id="])).toThrow("--id cannot be empty");
    for (const action of actions.filter(action => action !== "load")) {
      const target = action === "list" ? [] : ["bot"];
      expect(() => parseArguments(["gateway", action, ...target, "--id", "x"])).toThrow("--id is only valid for gateway load");
    }
  });

  test("install and upgrade accept --source; upgrade accepts --version", () => {
    expect(bootArgs(["gateway", "install", "telegram-bot@0.1.0", "--source", "./index.json"]).gatewayCommand)
      .toMatchObject({ action: "install", target: "telegram-bot@0.1.0", source: "./index.json" });
    expect(bootArgs(["gateway", "upgrade", "telegram-main", "--version", "0.2.0", "--source", "https://example.invalid/index.json"]).gatewayCommand)
      .toMatchObject({ action: "upgrade", target: "telegram-main", version: "0.2.0", source: "https://example.invalid/index.json" });
    expect(() => parseArguments(["gateway", "install", "bot", "--source="])).toThrow("--source cannot be empty");
    expect(() => parseArguments(["gateway", "upgrade", "bot", "--version="])).toThrow("--version cannot be empty");
    for (const action of actions.filter(action => action !== "install" && action !== "upgrade")) {
      const target = action === "list" ? [] : ["bot"];
      expect(() => parseArguments(["gateway", action, ...target, "--source", "x"]))
        .toThrow("--source is only valid for gateway install or upgrade");
    }
    for (const action of actions.filter(action => action !== "upgrade")) {
      const target = action === "list" ? [] : ["bot"];
      expect(() => parseArguments(["gateway", action, ...target, "--version", "1.0.0"]))
        .toThrow("--version is only valid for gateway upgrade");
    }
  });

  test("rejects --out and --target outside pack", () => {
    for (const action of actions.filter(action => action !== "pack")) {
      const target = action === "list" ? [] : ["bot"];
      expect(() => parseArguments(["gateway", action, ...target, "--out", "x"])).toThrow("--out is only valid for gateway pack");
      expect(() => parseArguments(["gateway", action, ...target, "--target", "linux-x64"])).toThrow("--target is only valid for gateway pack");
    }
  });

  test("rejects unknown actions, options and extra positionals", () => {
    expect(() => parseArguments(["gateway", "deploy", "bot"])).toThrow("Invalid gateway action");
    expect(() => parseArguments(["gateway"])).toThrow("gateway requires an action");
    expect(() => parseArguments(["gateway", "install", "bot", "extra"])).toThrow("only an action and an optional target");
    expect(() => parseArguments(["gateway", "list", "--mode", "gateway"])).toThrow("Unknown option '--mode'");
    expect(() => parseArguments(["gateway", "start", "bot", "--action", "start"])).toThrow("Unknown option '--action'");
    expect(() => parseArguments(["gateway", "list", "--clients", "bot"])).toThrow("Unknown option '--clients'");
    expect(() => parseArguments(["gateway", "list", "--port", "3200"])).toThrow("Unknown option '--port'");
  });

  test("accepts --sandbox and rejects an empty value", () => {
    expect(bootArgs(["gateway", "list", "--sandbox", "./project"])).toMatchObject({
      sandboxExplicit: true, sandbox: resolve("project"),
    });
    expect(() => parseArguments(["gateway", "list", "--sandbox="])).toThrow("--sandbox cannot be empty");
  });

  test("gateway --help returns help", () => {
    expect(parseArguments(["gateway", "--help"])).toBe("help");
    expect(parseArguments(["gateway", "pack", "--help"])).toBe("help");
  });

  test("keeps --mode gateway --action unchanged", () => {
    const args = bootArgs(["--mode", "gateway", "--action", "start", "--clients", "bot"]);
    expect(args).toMatchObject({ mode: "gateway", action: "start", clients: "bot" });
    expect(args.gatewayCommand).toBeUndefined();
  });
});
