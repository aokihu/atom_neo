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
