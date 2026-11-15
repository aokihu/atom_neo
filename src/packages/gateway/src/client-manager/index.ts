/** ClientManager facade: owns supervisors, port allocation and the health heartbeat. */
import type { Logger } from "@atom-neo/shared";
import type { ResolvedClientConfig } from "../client-package/resolver";
import type { GatewayConfig } from "../config";
import { HealthProbe } from "./health-probe";
import { ProcessSupervisor } from "./process-supervisor";
import type { ActiveClient } from "./process-supervisor";
import type { ProcessState } from "./process-state";
import { RestartPolicy } from "./restart-policy";
import { productionRuntime } from "./runtime";
import type { ClientManagerRuntime, IntervalHandle } from "./runtime";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEALTH_PROBE_TIMEOUT_MS = 5_000;
const MAX_PORT = 65_535;

export type { ActiveClient };

/** Public projection of an active client; the platform secret never leaves the gateway internals. */
export type ClientStatusActive = Pick<ActiveClient, "id" | "platform" | "port" | "url">;

export type ClientStatus = {
  id: string;
  platform: string;
  source: ResolvedClientConfig["source"];
  running: boolean;
  desired: boolean;
  state: ProcessState;
  port: number;
  active: ClientStatusActive | undefined;
  config: NonNullable<ResolvedClientConfig["manifest"]>["config"];
  clientArgs: Record<string, string>;
  secretFields: string[];
  stdio: ResolvedClientConfig["stdio"];
};

export class ClientManager {
  #config: GatewayConfig;
  #runtime: ClientManagerRuntime;
  #logger: Logger;
  #probe: HealthProbe;
  #configs = new Map<string, ResolvedClientConfig>();
  #supervisors = new Map<string, ProcessSupervisor>();
  #ports = new Set<number>();
  #portStart: number;
  #queues = new Map<string, Promise<void>>();
  #stopping = false;
  #heartbeatTimer: IntervalHandle | null = null;

  constructor(
    config: GatewayConfig,
    clients: readonly ResolvedClientConfig[],
    logger: Logger,
    runtime: ClientManagerRuntime = productionRuntime,
  ) {
    this.#config = config;
    this.#runtime = runtime;
    this.#logger = logger;
    this.#portStart = config.clientPortRangeStart;
    if (new Set(clients.map((client) => client.id)).size !== clients.length) {
      throw new Error("Gateway client IDs must be unique");
    }

    this.#probe = new HealthProbe({
      fetch: runtime.fetch,
      setTimeout: runtime.setTimeout,
      clearTimeout: runtime.clearTimeout,
      timeoutMs: HEALTH_PROBE_TIMEOUT_MS,
    });
    clients.forEach((client) => this.register(client));
  }

  /** Adds an idle instance: no process is started until `start`/`startAll`. */
  register(config: ResolvedClientConfig): void {
    if (this.#stopping) throw new Error("Gateway is stopping");
    if (this.#configs.has(config.id) || this.#supervisors.has(config.id)) {
      throw new Error(`Client already registered: ${config.id}`);
    }

    const port = this.#allocatePort();
    this.#configs.set(config.id, config);
    this.#supervisors.set(config.id, this.#createSupervisor(config.id, config, port));
  }

  getBySecret(secret: string): ActiveClient | undefined {
    for (const supervisor of this.#supervisors.values()) {
      const active = supervisor.active;
      if (active?.secret === secret) return active;
    }
    return undefined;
  }

  getById(id: string): ActiveClient | undefined {
    return this.#supervisors.get(id)?.active;
  }

  async startAll(): Promise<void> {
    for (const id of [...this.#supervisors.keys()]) await this.start(id);
    if (this.#heartbeatTimer !== null) this.#runtime.clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = this.#runtime.setInterval(() => {
      void this.#healthCheck();
    }, HEARTBEAT_INTERVAL_MS);
  }

  async stopAll(): Promise<void> {
    this.#stopping = true;
    if (this.#heartbeatTimer !== null) {
      this.#runtime.clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }

    // A reload already running before #stopping may still replace its supervisor.
    // Let those ordered operations finish before taking the stop snapshot.
    await Promise.allSettled([...this.#queues.values()]);
    const results = await Promise.allSettled(
      [...this.#supervisors.values()].map((supervisor) => supervisor.stop()),
    );
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (errors.length) throw new AggregateError(errors.map((result) => result.reason), "Clients failed to stop");
  }

  list(): { id: string; running: boolean; desired: boolean }[] {
    return [...this.#supervisors].map(([id, supervisor]) => ({
      id,
      running: supervisor.isRunning,
      desired: supervisor.desired,
    }));
  }

  status(): ClientStatus[] {
    return [...this.#supervisors].map(([id, supervisor]) => {
      const config = this.#configs.get(id);
      if (!config) throw new Error(`Missing config for client: ${id}`);
      const { active } = supervisor;
      return {
        id,
        platform: config.platform,
        source: config.source,
        running: supervisor.isRunning,
        desired: supervisor.desired,
        state: supervisor.state,
        port: supervisor.port,
        active: active && { id: active.id, platform: active.platform, port: active.port, url: active.url },
        config: config.manifest?.config ?? {},
        clientArgs: { ...(config.clientArgs ?? {}) },
        secretFields: Object.keys(config.credentials ?? {}),
        stdio: config.stdio,
      };
    });
  }

  start(id: string): Promise<void> {
    return this.#enqueue(id, async () => {
      const supervisor = this.#supervisors.get(id);
      if (!supervisor) throw new Error(`Unknown client: ${id}`);
      if (this.#stopping) throw new Error("Gateway is stopping");
      await supervisor.start();
    });
  }

  stop(id: string): Promise<void> {
    return this.#enqueue(id, async () => {
      const supervisor = this.#supervisors.get(id);
      if (!supervisor) throw new Error(`Unknown client: ${id}`);
      await supervisor.stop();
    });
  }

  /** Stops and removes an instance, releasing its port for the next registration. */
  remove(id: string): Promise<void> {
    return this.#enqueue(id, async () => {
      const supervisor = this.#supervisors.get(id);
      if (!supervisor) throw new Error(`Unknown client: ${id}`);
      await supervisor.stop();
      this.#supervisors.delete(id);
      this.#configs.delete(id);
      this.#ports.delete(supervisor.port);
    });
  }

  /**
   * Replaces one supervisor while keeping its identity, port and desired state.
   * The replacement is a fresh object, so late exit callbacks or restart timers
   * owned by the previous supervisor cannot reach the new process.
   */
  reload(id: string, config: ResolvedClientConfig): Promise<void> {
    return this.#enqueue(id, async () => {
      const previous = this.#supervisors.get(id);
      if (!previous) throw new Error(`Unknown client: ${id}`);
      if (this.#stopping) throw new Error("Gateway is stopping");
      if (config.id !== id) throw new Error(`Reload config id "${config.id}" does not match "${id}"`);

      const port = previous.port;
      const wasDesired = previous.desired;
      await previous.stop();

      const next = this.#createSupervisor(id, config, port);
      this.#configs.set(id, config);
      this.#supervisors.set(id, next);
      if (wasDesired) await next.start();
    });
  }

  #createSupervisor(id: string, config: ResolvedClientConfig, port: number): ProcessSupervisor {
    return new ProcessSupervisor({
      id,
      config,
      port,
      gatewayPort: () => this.#config.port,
      logger: this.#logger,
      runtime: this.#runtime,
      probe: this.#probe,
      policy: new RestartPolicy(),
    });
  }

  #allocatePort(): number {
    let port = this.#portStart;
    while (this.#ports.has(port)) port += 1;
    if (port > MAX_PORT) throw new Error("No free client port available");
    this.#ports.add(port);
    return port;
  }

  #enqueue<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(id) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    const tail = run.then(() => undefined, () => undefined);
    this.#queues.set(id, tail);
    void tail.then(() => {
      if (this.#queues.get(id) === tail) this.#queues.delete(id);
    });
    return run;
  }

  async #healthCheck(): Promise<void> {
    await Promise.allSettled([...this.#supervisors.values()].map((supervisor) => supervisor.checkHealth()));
  }
}
