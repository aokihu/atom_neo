import { generateSecret } from "../auth/secret";
import type { ClientConfig, GatewayConfig } from "../config";
import type { Logger } from "@atom-neo/shared";

const RESERVED_ARGS = new Set(["secret", "port", "gateway-url"]);

function buildClientArgs(clientArgs?: Record<string, string>): string[] {
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

export type ActiveClient = {
  id: string;
  platform: string;
  secret: string;
  port: number;
  url: string;
};

export class ClientManager {
  #config: GatewayConfig;
  #logger: Logger;
  #clients = new Map<string, ActiveClient>();
  #secretMap = new Map<string, ActiveClient>();
  #procs = new Map<string, { killed: boolean }>();
  #nextPort: number;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: GatewayConfig, logger: Logger) {
    this.#config = config;
    this.#logger = logger;
    this.#nextPort = config.clientPortRangeStart;
  }

  getBySecret(secret: string): ActiveClient | undefined {
    return this.#secretMap.get(secret);
  }

  getById(id: string): ActiveClient | undefined {
    return this.#clients.get(id);
  }

  async startAll(): Promise<void> {
    for (const cc of this.#config.clients) {
      await this.spawn(cc);
    }

    this.#heartbeatTimer = setInterval(() => this.#healthCheck(), 30_000);
  }

  async stopAll(): Promise<void> {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }

    for (const [id] of this.#clients) {
      await this.stop(id);
    }
  }

  private async spawn(cc: ClientConfig): Promise<void> {
    const { id, platform, binary, clientArgs } = cc;
    const secret = generateSecret();
    const port = this.#nextPort++;

    const client: ActiveClient = { id, platform, secret, port, url: `http://127.0.0.1:${port}` };
    this.#clients.set(id, client);
    this.#secretMap.set(secret, client);

    const userArgs = buildClientArgs(clientArgs);
    this.#logger.info("spawning client", { id, platform, port, binary, args: userArgs });

    const proc = Bun.spawn(
      [binary, "--secret", secret, "--port", String(port), "--gateway-url", `http://127.0.0.1:${this.#config.port}`, ...userArgs],
      {
        stdout: "pipe",
        stderr: "pipe",
        onExit: (_, exitCode, signalCode, error) => {
          this.#logger.warn("client exited", { id, platform, exitCode, signalCode, error: error?.message });
          if (this.#clients.has(id)) {
            this.#logger.info("restarting client", { id, platform });
            this.spawn(cc);
          }
        },
      },
    );

    this.#procs.set(id, { killed: false });
    this.#logger.debug("client process started", { id, pid: proc.pid });
  }

  private async stop(id: string): Promise<void> {
    const proc = this.#procs.get(id);
    if (proc) {
      proc.killed = true;
      this.#procs.delete(id);
    }
    this.#clients.delete(id);
    for (const [secret, client] of this.#secretMap) {
      if (client.id === id) this.#secretMap.delete(secret);
    }
  }

  async #healthCheck(): Promise<void> {
    for (const [, client] of this.#clients) {
      try {
        const res = await fetch(`${client.url}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          this.#logger.warn("client health check failed", { id: client.id, status: res.status });
        }
      } catch {
        this.#logger.warn("client unreachable", { id: client.id });
      }
    }
  }
}
