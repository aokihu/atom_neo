import { spawn } from "node:child_process";
import { constants } from "node:os";
import type { Readable } from "node:stream";

const SPAWN_ERROR_EXIT = -1;

export type ProcessHandle = {
  readonly pid: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly killed: boolean;
  /** Resolves with the numeric exit code once the process and its streams are closed. */
  readonly exited: Promise<number>;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  kill(signal?: NodeJS.Signals | number): void;
};

export type SpawnProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: "ignore" | "inherit" | "pipe";
  stdout?: "ignore" | "inherit" | "pipe";
  stderr?: "ignore" | "inherit" | "pipe";
  signal?: AbortSignal;
  killSignal?: NodeJS.Signals | number;
  /** Kill the child process group so piped descendants also exit. POSIX only. */
  killTree?: boolean;
  onExit?: (exitCode: number | null, signalCode: NodeJS.Signals | null, error?: Error) => void;
};

/**
 * Spawn a child process through node:child_process with a small, runtime-neutral handle.
 * `exited` waits for `close` so piped stdout/stderr have been fully consumed.
 */
export function spawnProcess(command: readonly string[], options: SpawnProcessOptions = {}): ProcessHandle {
  const [executable, ...args] = command;
  if (!executable) throw new Error("spawnProcess requires a command");

  let settled = false;
  let killed = false;
  let exitCode: number | null = null;
  let signalCode: NodeJS.Signals | null = null;
  let resolveExited!: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });

  const processGroup = options.killTree === true && process.platform !== "win32";
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.stdin ?? "ignore", options.stdout ?? "pipe", options.stderr ?? "pipe"],
    detached: processGroup,
    windowsHide: true,
  });

  const kill = (signal: NodeJS.Signals | number = "SIGTERM"): void => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    killed = true;
    if (processGroup && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    child.kill(signal);
  };

  const onAbort = () => kill(options.killSignal ?? "SIGTERM");
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  const settle = (code: number | null, signal: NodeJS.Signals | null, error?: Error): void => {
    if (settled) return;
    settled = true;
    options.signal?.removeEventListener("abort", onAbort);
    exitCode = code;
    signalCode = signal;
    const numericCode = code
      ?? (signal ? 128 + (constants.signals[signal] ?? 0) : error ? SPAWN_ERROR_EXIT : 0);
    try {
      options.onExit?.(code, signal, error);
    } finally {
      resolveExited(numericCode);
    }
  };

  child.on("exit", (code, signal) => {
    exitCode = code;
    signalCode = signal;
  });
  child.on("close", (code, signal) => settle(code, signal));
  child.on("error", (error) => settle(SPAWN_ERROR_EXIT, child.signalCode, error));

  return {
    get pid() { return child.pid ?? -1; },
    get exitCode() { return exitCode ?? child.exitCode; },
    get signalCode() { return signalCode ?? child.signalCode; },
    get killed() { return killed || child.killed; },
    exited,
    stdout: child.stdout,
    stderr: child.stderr,
    kill,
  };
}
