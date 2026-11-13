/** Graceful process termination: SIGTERM, bounded wait, then SIGKILL. */
import type { Logger, ProcessHandle } from "@atom-neo/shared";
import type { ClientManagerRuntime, TimerHandle } from "./runtime";

export const KILL_GRACE_TIMEOUT = 5_000;
export const KILL_FORCE_TIMEOUT = 3_000;

export type TerminationDeps = {
  id: string;
  logger: Logger;
  runtime: Pick<ClientManagerRuntime, "setTimeout" | "clearTimeout">;
};

export async function waitForExit(exited: Promise<number>, timeoutMs: number,
  runtime: TerminationDeps["runtime"]): Promise<boolean> {
  let timer: TimerHandle | undefined;
  try {
    return await Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = runtime.setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) runtime.clearTimeout(timer);
  }
}

/** SIGTERM, wait grace, then SIGKILL; logs the same fields as before the split. */
export async function terminateProcess(proc: ProcessHandle, deps: TerminationDeps): Promise<void> {
  const { pid } = proc;
  if (proc.exitCode === null) proc.kill();
  const exited = await waitForExit(proc.exited, KILL_GRACE_TIMEOUT, deps.runtime);

  if (exited) {
    deps.logger.info("client terminated gracefully", { id: deps.id, pid, exitCode: proc.exitCode });
    return;
  }

  deps.logger.warn("client did not exit gracefully, force killing", { id: deps.id, pid });
  proc.kill("SIGKILL");
  const forceExited = await waitForExit(proc.exited, KILL_FORCE_TIMEOUT, deps.runtime);
  if (forceExited) {
    deps.logger.info("client killed", { id: deps.id, pid, exitCode: proc.exitCode });
    return;
  }
  throw new Error(`Failed to kill client ${deps.id} (${pid})`);
}
