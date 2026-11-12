/** Per-client process lifecycle: spawn, readiness, health, stop and restart. */
import type { Logger, ProcessHandle } from "@atom-neo/shared";
import { generateSecret } from "../auth/secret";
import type { ClientConfig } from "../config";
import { buildClientCommand, buildSpawnOptions, waitUntilReady } from "./client-command";
import type { ActiveClient, ProcessSupervisorDeps } from "./client-command";
import type { HealthProbe } from "./health-probe";
import { nextProcessState } from "./process-state";
import type { ProcessEvent, ProcessState } from "./process-state";
import { terminateProcess } from "./process-termination";
import type { RestartPolicy } from "./restart-policy";
import type { ClientManagerRuntime, TimerHandle } from "./runtime";

export { buildClientArgs } from "./client-command";
export type { ActiveClient, ProcessSupervisorDeps } from "./client-command";

const HEALTH_PROBE_TIMEOUT_MS = 5_000;
const HEALTH_RESET_UPTIME_MS = 60_000;

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

  get state(): ProcessState { return this.#state; }

  get desired(): boolean { return this.#desired; }

  get active(): ActiveClient | undefined { return this.#active ?? undefined; }

  get isRunning(): boolean { return this.#proc !== null && this.#proc.exitCode === null; }

  start(): Promise<void> {
    this.#desired = true;
    if (!this.#stopping && this.#state === "running" && this.isRunning) return Promise.resolve();
    if (this.#pendingStart && !this.#stopping) return this.#pendingStart;

    this.#clearRestartTimer();
    const pending = this.#enqueue(() => this.#startProcess(false));
    this.#pendingStart = pending;
    void pending.then(() => this.#settlePendingStart(pending), () => this.#settlePendingStart(pending));
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
    const client: ActiveClient = { id: this.#id, platform: this.#config.platform, secret, port: this.#port, url: `http://127.0.0.1:${this.#port}` };

    const stdio = this.#config.stdio ?? "inherit";
    this.#logger.info("spawning client", { id: this.#id, platform: client.platform, port: client.port, binary: this.#config.binary, stdio });

    let proc: ProcessHandle | undefined;
    try {
      proc = this.#runtime.spawn(buildClientCommand(this.#config, client, this.#gatewayPort),
        buildSpawnOptions(stdio, (exitCode, signalCode, error) => this.#handleExit(generation, exitCode, signalCode, error)));
      this.#proc = proc;
      this.#active = client;
      this.#startedAt = this.#runtime.now();
      this.#setState({ type: "spawned" });
      this.#logger.debug("client process started", { id: this.#id, pid: proc.pid });

      await waitUntilReady(proc, client, { id: this.#id, probe: this.#probe, runtime: this.#runtime,
        isCurrent: candidate => !this.#stopping && this.#desired && this.#proc === candidate && candidate.exitCode === null });
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

  #handleExit(generation: number, exitCode: number | null, signalCode: NodeJS.Signals | null, error?: Error): void {
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

    this.#proc = null;
    this.#active = null;
    await terminateProcess(proc, { id: this.#id, logger: this.#logger, runtime: this.#runtime });
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
