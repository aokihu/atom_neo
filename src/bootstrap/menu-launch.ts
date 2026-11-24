import type { MenuLaunch } from "@atom-neo/config-tui";
import type { BootArguments } from "./cli";

/** Translate a menu selection into the exact boot arguments used by runApp. */
export function menuLaunchArguments(args: BootArguments, launch: MenuLaunch): BootArguments {
  if (launch.kind === "chat") {
    return {
      ...args, menu: false, configRoute: undefined, mode: undefined,
      sandbox: launch.sandbox, continueSession: launch.continueSession,
    };
  }
  if (launch.kind === "core") {
    return {
      ...args, menu: false, configRoute: undefined, mode: "core",
      sandbox: launch.sandbox, host: launch.host, port: launch.port,
    };
  }
  return {
    ...args, menu: false, configRoute: undefined, mode: "tui",
    sandbox: launch.sandbox, coreServer: launch.host, corePort: launch.port,
    continueSession: false, sessionId: launch.sessionId,
  };
}

type StartMenu = (sandbox: string, error?: string) => Promise<MenuLaunch | undefined>;
type RunApp = (args: BootArguments) => Promise<void>;

/** Reopen the menu after a failed launch, preserving the workspace chosen for that launch. */
export async function runMenuLoop(args: BootArguments, startMenu: StartMenu, runApp: RunApp): Promise<void> {
  let sandbox = args.sandbox;
  let lastError: string | undefined;
  for (;;) {
    const launch = await startMenu(sandbox, lastError);
    if (!launch) return;
    sandbox = launch.sandbox;
    try {
      await runApp(menuLaunchArguments(args, launch));
      return;
    } catch (error) {
      lastError = `Launch failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
