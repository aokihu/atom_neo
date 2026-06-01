import { existsSync, mkdirSync } from "node:fs";

export function isFirstRun(sandboxPath: string): boolean {
  return !existsSync(`${sandboxPath}/.atom/installed`);
}

export function markInstalled(sandboxPath: string): void {
  const installedPath = `${sandboxPath}/.atom/installed`;
  mkdirSync(`${sandboxPath}/.atom`, { recursive: true });
  Bun.write(installedPath, "");
}

function spawnWizard(sandboxPath: string): Bun.Subprocess {
  const isDev = existsSync(import.meta.path);

  if (isDev) {
    return Bun.spawn(
      [process.execPath, "run", import.meta.path, "--wizard", "--sandbox", sandboxPath],
      { stdio: ["inherit", "inherit", "inherit"] },
    );
  }
  return Bun.spawn(
    [process.execPath, "--wizard", "--sandbox", sandboxPath],
    { stdio: ["inherit", "inherit", "inherit"] },
  );
}

export async function runFirstRunWizard(sandboxPath: string): Promise<void> {
  const proc = spawnWizard(sandboxPath);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
