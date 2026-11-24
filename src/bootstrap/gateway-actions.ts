import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GatewayConfiguredDescription, GatewayInstanceActions } from "@atom-neo/config-tui";
import { parseManifest, sandboxPackageRoot } from "@atom-neo/gateway";
import { listInstances } from "@atom-neo/shared";
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

  const describe = async (id: string): Promise<GatewayConfiguredDescription> => {
    const instance = listInstances(sandbox).find(entry => entry.id === id);
    if (!instance) throw new Error(`Unknown client instance: ${id}`);
    const root = instance.package
      ? sandboxPackageRoot(sandbox)(instance.package.id, instance.package.version)
      : resolve(sandbox, instance.directory!);
    const manifest = parseManifest(readFileSync(join(root, "manifest.json"), "utf8"));
    return {
      config: manifest.config ?? {},
      clientArgs: { ...(instance.clientArgs ?? {}) },
      secretFields: Object.keys(instance.credentials ?? {}),
      stdio: instance.stdio,
      platform: manifest.platform,
    };
  };

  return {
    install: (archive) => run({ action: "install", target: archive, force: false, json: false }),
    load: (directory, id) => run({ action: "load", target: directory, id, force: false, json: false }),
    pack: (directory) => run({ action: "pack", target: directory, force: false, json: false }),
    describe,
  };
}
