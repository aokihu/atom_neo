/** Per-client process lifecycle: spawn, readiness, health, stop and restart. */
import { createChildProcessEnv } from "@atom-neo/shared";
import type { Logger, ProcessHandle, SpawnProcessOptions } from "@atom-neo/shared";
import { generateSecret } from "../auth/secret";
import type { ClientConfig } from "../config";
import type { HealthProbe } from "./health-probe";
import { nextProcessState } from "./process-state";
import type { ProcessEvent, ProcessState } from "./process-state";
import type { RestartPolicy } from "./restart-policy";
import type { ClientManagerRuntime, TimerHandle } from "./runtime";

const RESERVED_ARGS = new Set(["secret", "port", "gateway-url"]);
const READINESS_POLL_MS = 100;
const READINESS_TIMEOUT_MS = 10_000;
const READINESS_PROBE_TIMEOUT_MS = 500;
const HEALTH_PROBE_TIMEOUT_MS = 5_000;
const HEALTH_RESET_UPTIME_MS = 60_000;
const KILL_GRACE_TIMEOUT = 5_000;
const KILL_FORCE_TIMEOUT = 3_000;

export type ActiveClient = {
  id: string;
  platform: string;
  secret: string;
  port: number;
  url: string;
};

export type ProcessSupervisorDeps = {
  id: string;
  config: ClientConfig;
  port: number;
  gatewayPort: number;
  logger: Logger;
  runtime: ClientManagerRuntime;
  probe: HealthProbe;
  policy: RestartPolicy;
};

export function buildClientArgs(clientArgs?: Record<string, string>): string[] {
  if (!clientArgs) return [];
  const args: string[] = [];
  for (const [key, value] of Object.entries(clientArgs)) {
    if (RESERVED_ARGS.has(key)) {
      throw new Error(`clientArgs.${key} is reserved and managed by Gateway`);
    }
    args.push(`--${key}`, value);
  }
  return args;
}

export class ProcessSupervisor {
  #id: string;
  #config: ClientConfig;
  #port: number;
  #gatewayPort: number;
  #logger: Logger;
  #runtime: ClientManagerRuntime;
  #probe: HealthProbe;
  #policy: RestartPolicy;
  #state: ProcessState = "idle";
  #desired = false;
  #stopping = false;
  #proc: ProcessHandle | null = null;
  #active: ActiveClient | null = null;
  #startedAt = 0;
  #generation = 0;
  #restartTimer: TimerHandle | null = null;
  #queue: Promise<void> = Promise.resolve();
  #pendingStart: Promise<void> | null = null;

  constructor(deps: ProcessSupervisorDeps) {
    this.#id = deps.id;
    this.#config = deps.config;
    this.#port = deps.port;
    this.#gatewayPort = deps.gatewayPort;
    this.#logger = deps.logger;
    this.#runtime = deps.runtime;
    this.#probe = deps.probe;
    this.#policy = deps.policy;
  }

  get state(): ProcessState {
    return this.#state;
  }

  get desired(): boolean {
    return this.#desired;
  }

  get active(): ActiveClient | undefined {
    return this.#active ?? undefined;
  }

  get isRunning(): boolean {
    return this.#proc !== null && this.#proc.exitCode === null;
  }

  start(): Promise<void> {
    this.#desired = true;
    if (!this.#stopping && this.#state === "running" && this.isRunning) return Promise.resolve();
    if (this.#pendingStart && !this.#stopping) return this.#pendingStart;

    this.#clearRestartTimer();
    const pending = this.#enqueue(() => this.#startProcess(false));
    this.#pendingStart = pending;
    void pending.then(
      () => this.#settlePendingStart(pending),
      () => this.#settlePendingStart(pending),
    );
    return pending;
  }

  stop(): Promise<void> {
    this.#desired = false;
    this.#stopping = true;
    this.#clearRestartTimer();

    return this.#enqueue(async () => {
      try {
        if (this.#proc) {
          if (this.#state === "running" || this.#state === "starting") {
            this.#setState({ type: "stop" });
          }
          await this.#terminateProcess();
        }
        if (this.#state !== "idle") this.#setState({ type: "reset" });
      } catch (error) {
        if (this.#state === "stopping") this.#setState({ type: "exit", intentional: false });
        throw error;
      } finally {
        this.#stopping = false;
      }
    });
  }

  async checkHealth(): Promise<"healthy" | "unhealthy"> {
    const active = this.#active;
    if (this.#state !== "running" || !active || !this.#desired || this.#stopping) return "unhealthy";

    const result = await this.#probe.check(`${active.url}/health`, HEALTH_PROBE_TIMEOUT_MS);
    if (this.#state !== "running" || this.#active !== active || !this.#desired || this.#stopping) {
      return "unhealthy";
    }

    if (result.healthy) {
      if (this.#runtime.now() - this.#startedAt >= HEALTH_RESET_UPTIME_MS) this.#policy.reset();
      return "healthy";
    }

    if (result.reason === "status") {
      this.#logger.warn("client health check failed", { id: this.#id, status: result.status });
    } else {
      this.#logger.warn("client unreachable", { id: this.#id });
    }

    this.#setState({ type: "health_failed" });
    void this.#enqueue(() => this.#restartFromFailure()).catch((error) => {
      this.#logger.error("client restart failed", { id: this.#id, error: String(error) });
    });
    return "unhealthy";
  }

  async #startProcess(autoRestart: boolean): Promise<void> {
    if (!this.#desired) throw new Error(`Client ${this.#id} stopped before ready`);

    if (this.#proc) {
      if (this.#proc.exitCode === null) return;
      this.#proc = null;
      this.#active = null;
    }
    if (this.#state === "stopping") throw new Error(`Client ${this.#id} is stopping`);
    if (!autoRestart) {
      this.#clearRestartTimer();
      this.#policy.reset();
    }
    if (this.#state === "running") this.#setState({ type: "reset" });
    if (this.#state !== "starting") this.#setState({ type: "start" });

    this.#generation += 1;
    const generation = this.#generation;
    const secret = generateSecret();
    const client: ActiveClient = {
      id: this.#id,
      platform: this.#config.platform,
      secret,
      port: this.#port,
      url: `http://127.0.0.1:${this.#port}`,
    };

    const stdio = this.#config.stdio ?? "inherit";
    this.#logger.info("spawning client", {
      id: this.#id,
      platform: client.platform,
      port: client.port,
      binary: this.#config.binary,
      stdio,
    });

    let proc: ProcessHandle | undefined;
    try {
      proc = this.#runtime.spawn(this.#command(client), this.#spawnOptions(generation, stdio));
      this.#proc = proc;
      this.#active = client;
      this.#startedAt = this.#runtime.now();
      this.#setState({ type: "spawned" });
      this.#logger.debug("client process started", { id: this.#id, pid: proc.pid });

      await this.#waitUntilReady(proc, client);
      if (!this.#desired || this.#stopping || this.#proc !== proc) {
        throw new Error(`Client ${this.#id} stopped before ready`);
      }
      this.#setState({ type: "ready" });
    } catch (error) {
      if (proc && this.#proc === proc) await this.#terminateProcess();
      if (this.#stopping || !this.#desired) {
        this.#desired = false;
        this.#setState({ type: "reset" });
      } else {
        if (!autoRestart) this.#desired = false;
        this.#setState({ type: "exit", intentional: false });
      }
      throw error;
    }
  }

  async #waitUntilReady(proc: ProcessHandle, client: ActiveClient): Promise<void> {
    const deadline = this.#runtime.now() + READINESS_TIMEOUT_MS;
    while (true) {
      this.#assertStarting(proc);
      const remaining = deadline - this.#runtime.now();
      if (remaining <= 0) break;

      const result = await this.#probe.check(`${client.url}/health`, READINESS_PROBE_TIMEOUT_MS);
      if (result.healthy) return;
      this.#assertStarting(proc);

      const delay = Math.min(READINESS_POLL_MS, deadline - this.#runtime.now());
      if (delay <= 0) break;
      await this.#runtime.sleep(delay);
    }
    throw new Error(`Client ${this.#id} health check timed out`);
  }

  #assertStarting(proc: ProcessHandle): void {
    if (this.#stopping || !this.#desired || this.#proc !== proc || proc.exitCode !== null) {
      throw new Error(`Client ${this.#id} stopped before ready`);
    }
  }

  #spawnOptions(generation: number, stdio: "inherit" | "ignore"): SpawnProcessOptions {
    return {
      env: createChildProcessEnv(),
      stdin: "ignore",
      stdout: stdio,
      stderr: stdio,
      onExit: (exitCode, signalCode, error) => this.#handleExit(generation, exitCode, signalCode, error),
    };
  }

  #command(client: ActiveClient): string[] {
    const { binary, clientArgs } = this.#config;
    return [
      binary,
      "--secret", client.secret,
      "--port", String(client.port),
      "--gateway-url", `http://127.0.0.1:${this.#gatewayPort}`,
      ...buildClientArgs(clientArgs),
    ];
  }

  #handleExit(
    generation: number,
    exitCode: number | null,
    signalCode: NodeJS.Signals | null,
    error?: Error,
  ): void {
    this.#logger.warn("client exited", {
      id: this.#id,
      platform: this.#config.platform,
      exitCode,
      signalCode,
      error: error?.message,
    });
    if (generation !== this.#generation || !this.#proc) return;

    this.#proc = null;
    this.#active = null;

    if (this.#stopping || !this.#desired) {
      if (this.#state !== "idle") this.#setState({ type: "exit", intentional: true });
      return;
    }
    if (this.#state === "starting") {
      this.#setState({ type: "exit", intentional: false });
      return;
    }
    if (this.#state === "running") {
      this.#setState({ type: "exit", intentional: false });
      void this.#enqueue(() => this.#restartFromFailure());
    }
  }

  async #restartFromFailure(): Promise<void> {
    if (this.#proc) await this.#terminateProcess();
    if (!this.#desired || this.#stopping) {
      this.#clearRestartTimer();
      if (this.#state !== "idle") this.#setState({ type: "reset" });
      return;
    }
    this.#scheduleRestart();
  }

  #scheduleRestart(): void {
    if (!this.#desired || this.#stopping || this.#restartTimer !== null) {
      if (!this.#desired || this.#stopping) {
        this.#clearRestartTimer();
        if (this.#state !== "idle") this.#setState({ type: "reset" });
      }
      return;
    }

    const decision = this.#policy.next();
    if (decision.action === "give_up") {
      this.#logger.error("client restart limit reached", { id: this.#id, attempts: decision.attempts });
      this.#desired = false;
      this.#setState({ type: "reset" });
      return;
    }

    let handle: TimerHandle;
    handle = this.#runtime.setTimeout(() => {
      if (this.#restartTimer === handle) this.#restartTimer = null;
      void this.#enqueue(async () => {
        if (!this.#desired || this.#stopping) return;
        try {
          await this.#startProcess(true);
        } catch (error) {
          if (this.#desired && !this.#stopping) {
            this.#logger.error("client restart failed", { id: this.#id, error: String(error) });
            this.#scheduleRestart();
          }
        }
      });
    }, decision.delayMs);
    this.#restartTimer = handle;
  }

  async #terminateProcess(): Promise<void> {
    const proc = this.#proc;
    if (!proc) {
      this.#active = null;
      return;
    }

    const { pid } = proc;
    this.#proc = null;
    this.#active = null;

    if (proc.exitCode === null) proc.kill();
    const exited = await this.#waitForExit(proc.exited, KILL_GRACE_TIMEOUT);

    if (exited) {
      this.#logger.info("client terminated gracefully", { id: this.#id, pid, exitCode: proc.exitCode });
      return;
    }

    this.#logger.warn("client did not exit gracefully, force killing", { id: this.#id, pid });
    proc.kill("SIGKILL");
    const forceExited = await this.#waitForExit(proc.exited, KILL_FORCE_TIMEOUT);
    if (forceExited) {
      this.#logger.info("client killed", { id: this.#id, pid, exitCode: proc.exitCode });
      return;
    }
    throw new Error(`Failed to kill client ${this.#id} (${pid})`);
  }

  async #waitForExit(exited: Promise<number>, timeoutMs: number): Promise<boolean> {
    let timer: TimerHandle | undefined;
    try {
      return await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = this.#runtime.setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) this.#runtime.clearTimeout(timer);
    }
  }

  #clearRestartTimer(): void {
    if (this.#restartTimer === null) return;
    this.#runtime.clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
  }

  #settlePendingStart(pending: Promise<void>): void {
    if (this.#pendingStart === pending) this.#pendingStart = null;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation, operation);
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }

  #setState(event: ProcessEvent): void {
    this.#state = nextProcessState(this.#state, event);
  }
}
