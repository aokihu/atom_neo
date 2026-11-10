import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnProcess } from "@atom-neo/shared";
import type { ProcessHandle } from "@atom-neo/shared";
import { buildAppCommand } from "./cli";

export function isFirstRun(sandboxPath: string): boolean {
  return !existsSync(`${sandboxPath}/.atom/installed`);
}

export function markInstalled(sandboxPath: string): void {
  const installedPath = `${sandboxPath}/.atom/installed`;
  mkdirSync(`${sandboxPath}/.atom`, { recursive: true });
  writeFileSync(installedPath, "", "utf8");
}

export function buildWizardCommand(sandboxPath: string): string[] {
  return buildAppCommand(["--wizard", "--sandbox", sandboxPath]);
}

function spawnWizard(sandboxPath: string): ProcessHandle {
  return spawnProcess(buildWizardCommand(sandboxPath), {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
}

export async function runFirstRunWizard(sandboxPath: string): Promise<void> {
  const proc = spawnWizard(sandboxPath);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
