/** Client launch: argument mapping, active client, spawn options and readiness polling. */
import { createChildProcessEnv } from "@atom-neo/shared";
import type { Logger, ProcessHandle, SpawnProcessOptions } from "@atom-neo/shared";
import type { ClientConfig } from "../config";
import type { HealthProbe } from "./health-probe";
import type { RestartPolicy } from "./restart-policy";
import type { ClientManagerRuntime } from "./runtime";

const RESERVED_ARGS = new Set(["secret", "port", "gateway-url"]);
const READINESS_POLL_MS = 100;
const READINESS_TIMEOUT_MS = 10_000;
const READINESS_PROBE_TIMEOUT_MS = 500;

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

export type ActiveClient = {
  id: string;
  platform: string;
  secret: string;
  port: number;
  url: string;
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

export function buildClientCommand(config: ClientConfig, client: ActiveClient, gatewayPort: number): string[] {
  const { binary, clientArgs } = config;
  return [
    binary,
    "--secret", client.secret,
    "--port", String(client.port),
    "--gateway-url", `http://127.0.0.1:${gatewayPort}`,
    ...buildClientArgs(clientArgs),
  ];
}

export function buildSpawnOptions(stdio: "inherit" | "ignore", onExit: NonNullable<SpawnProcessOptions["onExit"]>): SpawnProcessOptions {
  return {
    env: createChildProcessEnv(),
    stdin: "ignore",
    stdout: stdio,
    stderr: stdio,
    onExit,
  };
}

export type ReadinessDeps = {
  id: string;
  probe: Pick<HealthProbe, "check">;
  runtime: Pick<ClientManagerRuntime, "now" | "sleep">;
  isCurrent: (proc: ProcessHandle) => boolean;
};

function assertStarting(proc: ProcessHandle, deps: ReadinessDeps): void {
  if (!deps.isCurrent(proc)) throw new Error(`Client ${deps.id} stopped before ready`);
}

export async function waitUntilReady(proc: ProcessHandle, client: ActiveClient, deps: ReadinessDeps): Promise<void> {
  const deadline = deps.runtime.now() + READINESS_TIMEOUT_MS;
  while (true) {
    assertStarting(proc, deps);
    const remaining = deadline - deps.runtime.now();
    if (remaining <= 0) break;

    const result = await deps.probe.check(`${client.url}/health`, READINESS_PROBE_TIMEOUT_MS);
    if (result.healthy) return;
    assertStarting(proc, deps);

    const delay = Math.min(READINESS_POLL_MS, deadline - deps.runtime.now());
    if (delay <= 0) break;
    await deps.runtime.sleep(delay);
  }
  throw new Error(`Client ${deps.id} health check timed out`);
}
