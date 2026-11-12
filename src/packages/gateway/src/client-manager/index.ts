/** ClientManager facade: owns supervisors, port allocation and the health heartbeat. */
import type { Logger } from "@atom-neo/shared";
import type { GatewayConfig } from "../config";
import { HealthProbe } from "./health-probe";
import { ProcessSupervisor } from "./process-supervisor";
import type { ActiveClient } from "./process-supervisor";
import { RestartPolicy } from "./restart-policy";
import { productionRuntime } from "./runtime";
import type { ClientManagerRuntime, IntervalHandle } from "./runtime";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEALTH_PROBE_TIMEOUT_MS = 5_000;

export type { ActiveClient };

export class ClientManager {
  #config: GatewayConfig;
  #runtime: ClientManagerRuntime;
  #supervisors = new Map<string, ProcessSupervisor>();
  #stopping = false;
  #heartbeatTimer: IntervalHandle | null = null;

  constructor(config: GatewayConfig, logger: Logger, runtime: ClientManagerRuntime = productionRuntime) {
    this.#config = config;
    this.#runtime = runtime;

    const probe = new HealthProbe({
      fetch: runtime.fetch,
      setTimeout: runtime.setTimeout,
      clearTimeout: runtime.clearTimeout,
      timeoutMs: HEALTH_PROBE_TIMEOUT_MS,
    });
    this.#config.clients.forEach((client, index) => {
      this.#supervisors.set(client.id, new ProcessSupervisor({
        id: client.id,
        config: client,
        port: this.#config.clientPortRangeStart + index,
        gatewayPort: this.#config.port,
        logger,
        runtime,
        probe,
        policy: new RestartPolicy(),
      }));
    });
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
    for (const client of this.#config.clients) await this.start(client.id);
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

    const results = await Promise.allSettled(this.#config.clients.map((client) => this.stop(client.id)));
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (errors.length) throw new AggregateError(errors.map((result) => result.reason), "Clients failed to stop");
  }

  list(): { id: string; running: boolean; desired: boolean }[] {
    return this.#config.clients.map((client) => {
      const supervisor = this.#supervisors.get(client.id);
      return {
        id: client.id,
        running: supervisor?.isRunning ?? false,
        desired: supervisor?.desired ?? false,
      };
    });
  }

  start(id: string): Promise<void> {
    const supervisor = this.#supervisors.get(id);
    if (!supervisor) return Promise.reject(new Error(`Unknown client: ${id}`));
    if (this.#stopping) return Promise.reject(new Error("Gateway is stopping"));
    return supervisor.start();
  }

  stop(id: string): Promise<void> {
    const supervisor = this.#supervisors.get(id);
    if (!supervisor) return Promise.reject(new Error(`Unknown client: ${id}`));
    return supervisor.stop();
  }

  async #healthCheck(): Promise<void> {
    await Promise.allSettled([...this.#supervisors.values()].map((supervisor) => supervisor.checkHealth()));
  }
}
