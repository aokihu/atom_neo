import type { GatewayInstanceActions } from "@atom-neo/config-tui";
import type { GatewayCommand } from "./cli";
import { runGatewayCommand } from "./gateway-command";

/** Capture CLI output for the config-tui gateway modal; never includes secrets. */
export function createGatewayActions(sandbox: string): GatewayInstanceActions {
  const run = async (command: GatewayCommand): Promise<string> => {
    const lines: string[] = [];
    await runGatewayCommand(command, { sandbox }, { stdout: (line) => lines.push(line) });
    return lines.join("\n");
  };

  return {
    install: (archive) => run({ action: "install", target: archive, force: false, json: false }),
    load: (directory, id) => run({ action: "load", target: directory, id, force: false, json: false }),
    pack: (directory) => run({ action: "pack", target: directory, force: false, json: false }),
  };
}
