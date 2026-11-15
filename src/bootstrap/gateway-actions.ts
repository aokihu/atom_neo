import type { GatewayInstanceActions } from "@atom-neo/config-tui";
import type { GatewayCommand } from "./cli";
import { runGatewayCommand } from "./gateway-command";

/** Capture CLI output for the config-tui gateway modal; never includes secrets. */
export function createGatewayActions(sandbox: string): GatewayInstanceActions {
  const run = async (command: GatewayCommand): Promise<string> => {
    const lines: string[] = [];
    try {
      await runGatewayCommand(command, { sandbox }, { stdout: (line) => lines.push(line) });
      return lines.join("\n");
    } catch (error) {
      const output = lines.join("\n");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(output ? `${output}\n${message}` : message);
    }
  };

  return {
    install: (archive) => run({ action: "install", target: archive, force: false, json: false }),
    load: (directory, id) => run({ action: "load", target: directory, id, force: false, json: false }),
    pack: (directory) => run({ action: "pack", target: directory, force: false, json: false }),
  };
}
