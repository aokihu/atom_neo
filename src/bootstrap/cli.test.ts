import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseArguments } from "./cli";

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
