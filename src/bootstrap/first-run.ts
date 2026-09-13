import { existsSync, mkdirSync } from "node:fs";

export function isFirstRun(sandboxPath: string): boolean {
  return !existsSync(`${sandboxPath}/.atom/installed`);
}

export function markInstalled(sandboxPath: string): void {
  const installedPath = `${sandboxPath}/.atom/installed`;
  mkdirSync(`${sandboxPath}/.atom`, { recursive: true });
  Bun.write(installedPath, "");
}

export function buildWizardCommand(sandboxPath: string): string[] {
  // Compiled entrypoints live in Bun's virtual filesystem, where existsSync is also true.
  const compiled = Bun.main.startsWith("/$bunfs/");
  return [process.execPath, ...(compiled ? [] : ["run", Bun.main]), "--wizard", "--sandbox", sandboxPath];
}

function spawnWizard(sandboxPath: string): Bun.Subprocess {
  return Bun.spawn(buildWizardCommand(sandboxPath), { stdio: ["inherit", "inherit", "inherit"] });
}

export async function runFirstRunWizard(sandboxPath: string): Promise<void> {
  const proc = spawnWizard(sandboxPath);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
