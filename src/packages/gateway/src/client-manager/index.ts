import { generateSecret } from "../auth/secret";
import type { ClientConfig, GatewayConfig } from "../config";
import type { Logger } from "@atom-neo/shared";

const RESERVED_ARGS = new Set(["secret", "port", "gateway-url"]);
const MAX_RESTART_ATTEMPTS = 5;
const MAX_RESTART_BACKOFF = 30_000;
const KILL_GRACE_TIMEOUT = 5000;
const KILL_FORCE_TIMEOUT = 3000;

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

type ProcEntry = { proc: { pid: number; killed: boolean; exitCode: number | null; exited: Promise<number>; kill(signal?: NodeJS.Signals | number): void }; pid: number; killed: boolean };

export class ClientManager {
  #config: GatewayConfig;
  #logger: Logger;
  #clients = new Map<string, ActiveClient>();
  #secretMap = new Map<string, ActiveClient>();
  #procs = new Map<string, ProcEntry>();
  #restartAttempts = new Map<string, number>();
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

    const userArgs = buildClientArgs(clientArgs);
    const stdio = cc.stdio ?? "inherit";
    this.#logger.info("spawning client", { id, platform, port, binary, args: userArgs, stdio });

    const proc = Bun.spawn(
      [binary, "--secret", secret, "--port", String(port), "--gateway-url", `http://127.0.0.1:${this.#config.port}`, ...userArgs],
      {
        stdout: stdio,
        stderr: stdio,
        onExit: (_, exitCode, signalCode, error) => {
          this.#logger.warn("client exited", { id, platform, exitCode, signalCode, error: error?.message });
          const entry = this.#procs.get(id);
          if (entry?.killed) {
            this.#logger.debug("client was intentionally stopped, not restarting", { id });
            return;
          }
          if (!this.#clients.has(id)) return;
          const attempts = this.#restartAttempts.get(id) ?? 0;
          if (attempts >= MAX_RESTART_ATTEMPTS) {
            this.#logger.error("client restart limit reached, giving up", { id, attempts });
            return;
          }
          const backoffMs = Math.min(1000 * Math.pow(2, attempts), MAX_RESTART_BACKOFF);
          this.#restartAttempts.set(id, attempts + 1);
          this.#logger.info("restarting client with backoff", { id, platform, attempt: attempts + 1, backoffMs });
          setTimeout(() => this.spawn(cc), backoffMs);
        },
      },
    );

    // spawn 成功后才注册 secret，避免 spawn 失败时 secret 泄漏在 map 中
    const client: ActiveClient = { id, platform, secret, port, url: `http://127.0.0.1:${port}` };
    this.#clients.set(id, client);
    this.#secretMap.set(secret, client);
    this.#procs.set(id, { proc, pid: proc.pid, killed: false });
    // 成功启动后重置重启计数
    this.#restartAttempts.delete(id);
    this.#logger.debug("client process started", { id, pid: proc.pid });
  }

  private async stop(id: string): Promise<void> {
    const entry = this.#procs.get(id);
    if (!entry) {
      this.#clients.delete(id);
      this.#removeSecretById(id);
      return;
    }

    const { proc, pid } = entry;
    entry.killed = true;

    // SIGTERM → 等待优雅退出
    proc.kill();
    const exited = await Promise.race([proc.exited.then(() => true), sleep(KILL_GRACE_TIMEOUT).then(() => false)]);

    if (exited) {
      this.#logger.info("client terminated gracefully", { id, pid, exitCode: proc.exitCode });
    } else {
      this.#logger.warn("client did not exit gracefully, force killing", { id, pid });
      proc.kill("SIGKILL");
      const forceExited = await Promise.race([proc.exited.then(() => true), sleep(KILL_FORCE_TIMEOUT).then(() => false)]);
      if (forceExited) {
        this.#logger.info("client killed", { id, pid, exitCode: proc.exitCode });
      } else {
        this.#logger.error("failed to kill client process", { id, pid });
      }
    }

    this.#procs.delete(id);
    this.#clients.delete(id);
    this.#removeSecretById(id);
  }

  #removeSecretById(id: string): void {
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
