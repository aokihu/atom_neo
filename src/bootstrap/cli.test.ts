import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseArguments } from "./cli";

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

describe("parseArguments --config", () => {
  test("defaults to false", () => {
    const args = parseArguments(["--sandbox", "/tmp/sb"]) as any;
    expect(args.config).toBe(false);
  });

  test("detects the --config flag", () => {
    const args = parseArguments(["--config", "--sandbox", "/tmp/sb"]) as any;
    expect(args.config).toBe(true);
  });

  test("coexists with mode flags", () => {
    const args = parseArguments(["--mode", "core", "--config"]) as any;
    expect(args.mode).toBe("core");
    expect(args.config).toBe(true);
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


describe("parseArguments session continuation", () => {
  test.each([{ args: [], expected: false }, { args: ["-c"], expected: true }, { args: ["--continue"], expected: true },
    { args: ["--mode", "tui", "--core-server", "localhost", "--core-port", "3100", "-c"], expected: true }])("parses $args", ({ args, expected }) => {
    const parsed = parseArguments(args);
    if (parsed === "help") throw new Error("Unexpected help");
    expect(parsed.continueSession).toBe(expected);
  });
});
