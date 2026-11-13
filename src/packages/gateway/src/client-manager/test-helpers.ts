/** Fake runtime/process/clock for ClientManager tests; never spawns real processes. */
import type { ProcessHandle, SpawnProcessOptions } from "@atom-neo/shared";
import type { ClientManagerRuntime, FetchLike, TimerHandle } from "./runtime";

type FakeTimer = { id: number; at: number; fn: () => void; intervalMs?: number };

export class FakeClock {
  #now = 0;
  #nextId = 1;
  #timers = new Map<unknown, FakeTimer>();

  get pendingTimers(): number {
    return this.#timers.size;
  }

  now = (): number => this.#now;

  setTimeout = (fn: () => void, ms: number): TimerHandle => {
    const id = this.#nextId++;
    const handle = id as unknown as TimerHandle;
    this.#timers.set(handle, { id, at: this.#now + Math.max(0, ms), fn });
    return handle;
  };

  clearTimeout = (handle: TimerHandle): void => {
    this.#timers.delete(handle);
  };

  setInterval = (fn: () => void, ms: number): ReturnType<typeof setInterval> => {
    const id = this.#nextId++;
    const handle = id as unknown as ReturnType<typeof setInterval>;
    this.#timers.set(handle, { id, at: this.#now + Math.max(1, ms), fn, intervalMs: Math.max(1, ms) });
    return handle;
  };

  clearInterval = (handle: ReturnType<typeof setInterval>): void => {
    this.#timers.delete(handle);
  };

  sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      this.setTimeout(resolve, ms);
    });

  async flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }

  async advance(ms: number): Promise<void> {
    await this.flush();
    const target = this.#now + ms;
    while (true) {
      const next = [...this.#timers.values()]
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;

      this.#now = next.at;
      if (next.intervalMs === undefined) {
        for (const [handle, timer] of this.#timers) {
          if (timer === next) this.#timers.delete(handle);
        }
      } else {
        next.at += next.intervalMs;
      }
      next.fn();
      await this.flush();
    }
    this.#now = target;
    await this.flush();
  }
}

export type FakeProcessOptions = {
  pid?: number;
  autoExitOnKill?: "always" | "sigkill" | "never";
  exitCodeOnKill?: number;
};

export class FakeProcess implements ProcessHandle {
  readonly pid: number;
  readonly exited: Promise<number>;
  readonly stdout = null;
  readonly stderr = null;
  readonly killSignals: (NodeJS.Signals | number)[] = [];
  onExit?: (exitCode: number | null, signalCode: NodeJS.Signals | null, error?: Error) => void;
  #exitCode: number | null = null;
  #signalCode: NodeJS.Signals | null = null;
  #settled = false;
  #killed = false;
  #resolveExited!: (code: number) => void;
  #autoExitOnKill: NonNullable<FakeProcessOptions["autoExitOnKill"]>;
  #exitCodeOnKill: number;

  constructor(options: FakeProcessOptions = {}) {
    this.pid = options.pid ?? 1000;
    this.#autoExitOnKill = options.autoExitOnKill ?? "always";
    this.#exitCodeOnKill = options.exitCodeOnKill ?? 0;
    this.exited = new Promise((resolve) => {
      this.#resolveExited = resolve;
    });
  }

  get exitCode(): number | null {
    return this.#exitCode;
  }

  get signalCode(): NodeJS.Signals | null {
    return this.#signalCode;
  }

  get killed(): boolean {
    return this.#killed;
  }

  kill(signal: NodeJS.Signals | number = "SIGTERM"): void {
    this.killSignals.push(signal);
    this.#killed = true;
    const shouldExit = this.#autoExitOnKill === "always"
      || (this.#autoExitOnKill === "sigkill" && signal === "SIGKILL");
    if (shouldExit) {
      this.exit(this.#exitCodeOnKill, typeof signal === "string" ? signal : null);
    }
  }

  exit(code = 0, signal: NodeJS.Signals | null = null, error?: Error): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#exitCode = code;
    this.#signalCode = signal;
    this.#resolveExited(code);
    this.onExit?.(code, signal, error);
  }
}

export type FakeSpawnCall = { command: readonly string[]; options?: SpawnProcessOptions };

export type FakeRuntime = {
  runtime: ClientManagerRuntime;
  clock: FakeClock;
  processes: FakeProcess[];
  spawnCalls: FakeSpawnCall[];
  setFetch: (fetch: FetchLike) => void;
  setSpawn: (spawn: ClientManagerRuntime["spawn"]) => void;
};

export function createFakeRuntime(): FakeRuntime {
  const clock = new FakeClock();
  const processes: FakeProcess[] = [];
  const spawnCalls: FakeSpawnCall[] = [];

  let fetchImpl: FetchLike = async () => new Response("ok", { status: 200 });
  let spawnImpl: ClientManagerRuntime["spawn"] = (command, options) => {
    spawnCalls.push({ command, options });
    const proc = new FakeProcess({ pid: 1000 + processes.length });
    proc.onExit = options?.onExit;
    processes.push(proc);
    return proc;
  };

  const runtime: ClientManagerRuntime = {
    spawn: (command, options) => spawnImpl(command, options),
    fetch: (input, init) => fetchImpl(input, init),
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    sleep: clock.sleep,
  };

  return {
    runtime,
    clock,
    processes,
    spawnCalls,
    setFetch: (fetch) => { fetchImpl = fetch; },
    setSpawn: (spawn) => { spawnImpl = spawn; },
  };
}
