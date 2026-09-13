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

type ProcEntry = { proc: { pid: number; killed: boolean; exitCode: number | null; exited: Promise<number>; kill(signal?: NodeJS.Signals | number): void }; pid: number; killed: boolean; startedAt: number };

export class ClientManager {
  #config: GatewayConfig;
  #logger: Logger;
  #clients = new Map<string, ActiveClient>();
  #secretMap = new Map<string, ActiveClient>();
  #procs = new Map<string, ProcEntry>();
  #restartAttempts = new Map<string, number>();
  #desired = new Set<string>();
  #restarts = new Map<string, ReturnType<typeof setTimeout>>();
  #operations = new Map<string, Promise<void>>();
  #stopping = false;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: GatewayConfig, logger: Logger) {
    this.#config = config;
    this.#logger = logger;
  }

  getBySecret(secret: string): ActiveClient | undefined {
    return this.#secretMap.get(secret);
  }

  getById(id: string): ActiveClient | undefined {
    return this.#clients.get(id);
  }

  async startAll(): Promise<void> {
    for (const cc of this.#config.clients) {
      await this.start(cc.id);
    }

    this.#heartbeatTimer = setInterval(() => this.#healthCheck(), 30_000);
  }

  async stopAll(): Promise<void> {
    this.#stopping = true;
    for (const id of this.#desired) this.#desired.delete(id);
    for (const timer of this.#restarts.values()) clearTimeout(timer);
    this.#restarts.clear();
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }

    const results = await Promise.allSettled(this.#config.clients.map(c => this.stop(c.id)));
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (errors.length) throw new AggregateError(errors.map(r => r.reason), "Clients failed to stop");
  }

  list(): { id: string; running: boolean; desired: boolean }[] {
    return this.#config.clients.map(cc => ({ id: cc.id, running: this.#procs.get(cc.id)?.proc.exitCode === null, desired: this.#desired.has(cc.id) }));
  }

  #serialize(id: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.#operations.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.#operations.set(id, next);
    void next.finally(() => { if (this.#operations.get(id) === next) this.#operations.delete(id); }).catch(() => {});
    return next;
  }

  start(id: string): Promise<void> {
    const cc = this.#config.clients.find(c => c.id === id);
    if (!cc) return Promise.reject(new Error(`Unknown client: ${id}`));
    return this.#serialize(id, async () => {
      if (this.#stopping) throw new Error("Gateway is stopping");
      this.#desired.add(id);
      if (this.#procs.get(id)?.proc.exitCode === null) return;
      const timer = this.#restarts.get(id);
      if (timer) clearTimeout(timer);
      this.#restarts.delete(id);
      this.#restartAttempts.delete(id);
      try { await this.spawn(cc); } catch (error) {
        this.#desired.delete(id);
        const pending = this.#restarts.get(id);
        if (pending) clearTimeout(pending);
        this.#restarts.delete(id);
        throw error;
      }
    });
  }

  stop(id: string): Promise<void> {
    if (!this.#config.clients.some(c => c.id === id)) return Promise.reject(new Error(`Unknown client: ${id}`));
    this.#desired.delete(id);
    const timer = this.#restarts.get(id);
    if (timer) clearTimeout(timer);
    this.#restarts.delete(id);
    return this.#serialize(id, async () => {
      this.#desired.delete(id);
      const pending = this.#restarts.get(id);
      if (pending) clearTimeout(pending);
      this.#restarts.delete(id);
      await this.stopProcess(id);
    });
  }

  #scheduleRestart(cc: ClientConfig): void {
    const id = cc.id;
    if (this.#stopping || !this.#desired.has(id) || this.#restarts.has(id)) return;
    const attempts = this.#restartAttempts.get(id) ?? 0;
    if (attempts >= MAX_RESTART_ATTEMPTS) {
      this.#logger.error("client restart limit reached", { id, attempts });
      return;
    }
    this.#restartAttempts.set(id, attempts + 1);
    this.#restarts.set(id, setTimeout(() => {
      this.#restarts.delete(id);
      void this.#serialize(id, async () => {
        if (!this.#stopping && this.#desired.has(id)) await this.spawn(cc);
      }).catch(error => {
        this.#logger.error("client restart failed", { id, error: String(error) });
        this.#scheduleRestart(cc);
      });
    }, Math.min(1000 * 2 ** attempts, MAX_RESTART_BACKOFF)));
  }

  private async spawn(cc: ClientConfig): Promise<void> {
    const { id, platform, binary, clientArgs } = cc;
    const secret = generateSecret();
    const port = this.#config.clientPortRangeStart + this.#config.clients.findIndex(c => c.id === id);

    const userArgs = buildClientArgs(clientArgs);
    const stdio = cc.stdio ?? "inherit";
    this.#logger.info("spawning client", { id, platform, port, binary, stdio });

    const proc = Bun.spawn(
      [binary, "--secret", secret, "--port", String(port), "--gateway-url", `http://127.0.0.1:${this.#config.port}`, ...userArgs],
      {
        stdout: stdio,
        stderr: stdio,
        onExit: (_, exitCode, signalCode, error) => {
          this.#logger.warn("client exited", { id, platform, exitCode, signalCode, error: error?.message });
          const entry = this.#procs.get(id);
          if (entry?.proc !== proc) return;
          this.#removeSecretById(id);
          this.#clients.delete(id);
          if (entry?.killed || this.#stopping || !this.#desired.has(id)) {
            this.#logger.debug("client was intentionally stopped, not restarting", { id });
            return;
          }
          this.#scheduleRestart(cc);
        },
      },
    );

    // spawn 成功后才注册 secret，避免 spawn 失败时 secret 泄漏在 map 中
    const client: ActiveClient = { id, platform, secret, port, url: `http://127.0.0.1:${port}` };
    this.#clients.set(id, client);
    this.#secretMap.set(secret, client);
    this.#procs.set(id, { proc, pid: proc.pid, killed: false, startedAt: Date.now() });
    this.#logger.debug("client process started", { id, pid: proc.pid });
    try {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (this.#stopping || !this.#desired.has(id) || proc.exitCode !== null) throw new Error(`Client ${id} stopped before ready`);
        try {
          const response = await fetch(`${client.url}/health`, { signal: AbortSignal.timeout(500) });
          if (response.ok) return;
        } catch { /* client may still be starting */ }
        await sleep(100);
      }
      throw new Error(`Client ${id} health check timed out`);
    } catch (error) {
      const timer = this.#restarts.get(id);
      if (timer) clearTimeout(timer);
      this.#restarts.delete(id);
      await this.stopProcess(id);
      throw error;
    }
  }

  private async stopProcess(id: string): Promise<void> {
    const entry = this.#procs.get(id);
    if (!entry) {
      this.#clients.delete(id);
      this.#removeSecretById(id);
      return;
    }

    this.#removeSecretById(id);
    const { proc, pid } = entry;
    entry.killed = true;

    // SIGTERM → 等待优雅退出
    if (proc.exitCode === null) proc.kill();
    const exited = await waitForExit(proc.exited, KILL_GRACE_TIMEOUT);

    if (exited) {
      this.#logger.info("client terminated gracefully", { id, pid, exitCode: proc.exitCode });
    } else {
      this.#logger.warn("client did not exit gracefully, force killing", { id, pid });
      proc.kill("SIGKILL");
      const forceExited = await waitForExit(proc.exited, KILL_FORCE_TIMEOUT);
      if (forceExited) {
        this.#logger.info("client killed", { id, pid, exitCode: proc.exitCode });
      } else {
        throw new Error(`Failed to kill client ${id} (${pid})`);
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
        if (res.ok && Date.now() - (this.#procs.get(client.id)?.startedAt ?? Date.now()) >= 60_000) this.#restartAttempts.delete(client.id);
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

async function waitForExit(exited: Promise<number>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([exited.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}
