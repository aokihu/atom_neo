import { describe, expect, test } from "bun:test";
import type { MenuLaunch } from "@atom-neo/config-tui";
import { parseArguments } from "./cli";
import type { BootArguments } from "./cli";
import { menuLaunchArguments, runMenuLoop } from "./menu-launch";

function boot(): BootArguments {
  const args = parseArguments([]);
  if (args === "help") throw new Error("unexpected help");
  return args;
}

const launches: MenuLaunch[] = [
  { kind: "chat", sandbox: "/ws", continueSession: true },
  { kind: "core", sandbox: "/ws", host: "127.0.0.1", port: 3200 },
  { kind: "attach", sandbox: "/ws", host: "127.0.0.1", port: 3300, sessionId: "tui-1" },
];

describe("menu launch mapping", () => {
  test("maps chat to the default full app", () => {
    expect(menuLaunchArguments(boot(), launches[0]!)).toMatchObject({
      menu: false, configRoute: undefined, mode: undefined,
      sandbox: "/ws", continueSession: true,
    });
  });

  test("maps core to server mode with host and port", () => {
    expect(menuLaunchArguments(boot(), launches[1]!)).toMatchObject({
      menu: false, configRoute: undefined, mode: "core",
      sandbox: "/ws", host: "127.0.0.1", port: 3200,
    });
  });

  test("maps attach to TUI mode with the selected session", () => {
    expect(menuLaunchArguments(boot(), launches[2]!)).toMatchObject({
      menu: false, configRoute: undefined, mode: "tui",
      sandbox: "/ws", coreServer: "127.0.0.1", corePort: 3300,
      continueSession: false, sessionId: "tui-1",
    });
  });

  test("preserves unrelated boot arguments", () => {
    const args = { ...boot(), logLevel: "error" as const, sandboxExplicit: true };
    expect(menuLaunchArguments(args, launches[1]!).logLevel).toBe("error");
    expect(menuLaunchArguments(args, launches[1]!).sandboxExplicit).toBe(true);
  });
});

describe("menu launch retry", () => {
  test("reopens the menu with the failure and the last chosen workspace", async () => {
    const errors: Array<string | undefined> = [];
    const sandboxes: string[] = [];
    const attempts: BootArguments[] = [];
    const queued = [launches[1]!, { ...launches[2]!, sandbox: "/changed" }, launches[0]!];
    await runMenuLoop(
      { ...boot(), sandbox: "/ws" },
      async (sandbox, error) => {
        sandboxes.push(sandbox);
        errors.push(error);
        return queued.shift();
      },
      async (args) => {
        attempts.push(args);
        if (args.mode === "core") throw new Error("EADDRINUSE");
        if (args.mode === "tui") throw new Error("Cannot attach Core (404)");
      },
    );
    expect(sandboxes).toEqual(["/ws", "/ws", "/changed"]);
    expect(errors).toEqual([undefined, "Launch failed: EADDRINUSE", "Launch failed: Cannot attach Core (404)"]);
    expect(attempts.map(args => args.mode)).toEqual(["core", "tui", undefined]);
  });

  test("stops when the menu is dismissed", async () => {
    let started = 0;
    let ran = 0;
    await runMenuLoop(boot(), async () => { started++; return undefined; }, async () => { ran++; });
    expect(started).toBe(1);
    expect(ran).toBe(0);
  });
});
