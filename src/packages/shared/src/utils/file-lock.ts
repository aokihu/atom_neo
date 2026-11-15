import { closeSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type FileLockOptions = {
  /** Maximum time to wait for an existing lock; 0 (default) fails immediately. */
  timeoutMs?: number;
  /** Delay between acquisition attempts while waiting for an existing lock. */
  retryMs?: number;
  /** Error message used when the lock cannot be acquired before the timeout. */
  lockedMessage?: string;
};

/** Synchronous sleep without spawning a process or tying up CPU. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run a synchronous action while holding an exclusive lock file.
 *
 * The lock is created exclusively (mode 0600) and removed when the action finishes. Waiting is
 * bounded by `timeoutMs`; a stale lock left by a crashed process is not reclaimed automatically
 * and must be removed manually after confirming no process still owns it.
 */
export function withFileLock<T>(lockPath: string, action: () => T, options: FileLockOptions = {}): T {
  mkdirSync(dirname(lockPath), { recursive: true });

  const requestedTimeout = options.timeoutMs ?? 0;
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 0;
  const retryMs = Math.max(1, options.retryMs ?? 25);
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0;

  let descriptor: number;
  for (;;) {
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const remaining = deadline - Date.now();
      if (deadline === 0 || remaining <= 0) {
        throw new Error(options.lockedMessage ?? `File lock is busy after ${timeoutMs}ms: ${lockPath}`);
      }
      sleepSync(Math.min(retryMs, remaining));
    }
  }

  try {
    writeFileSync(descriptor, `${process.pid}\n`, "utf8");
    closeSync(descriptor);
  } catch (error) {
    try { closeSync(descriptor); } catch { /* already closed or unusable */ }
    rmSync(lockPath, { force: true });
    throw error;
  }

  try {
    return action();
  } finally {
    rmSync(lockPath, { force: true });
  }
}
