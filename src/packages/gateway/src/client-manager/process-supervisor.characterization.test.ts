/**
 * Command/termination snapshot for ProcessSupervisor (S12-E9).
 *
 * Locks: buildClientArgs order/reserved, exact spawn command/env/stdio/onExit,
 * SIGTERM -> grace -> SIGKILL order, active cleanup and log messages.
 */
import { describe, expect, test } from "bun:test";
import { Logger } from "@atom-neo/shared";
import type { ClientConfig } from "../config";
import { buildClientArgs, buildClientCommand } from "./client-command";
import { HealthProbe } from "./health-probe";
import { ProcessSupervisor } from "./process-supervisor";
import { RestartPolicy } from "./restart-policy";
import { createFakeRuntime, FakeProcess } from "./test-helpers";
import type { FakeRuntime } from "./test-helpers";

const CLIENT: ClientConfig = { id: "bot", platform: "telegram", binary: "/bin/bot", stdio: "ignore" };

function createSupervisor(fake: FakeRuntime, config: ClientConfig = CLIENT) {
  const entries: any[] = [];
  const logger = new Logger("debug", entry => entries.push(entry));
  return {
    entries,
    supervisor: new ProcessSupervisor({ id: config.id, config, port: 4_200, gatewayPort: 3_000, logger,
      runtime: fake.runtime, probe: new HealthProbe({ fetch: fake.runtime.fetch, setTimeout: fake.runtime.setTimeout,
        clearTimeout: fake.runtime.clearTimeout, timeoutMs: 500 }), policy: new RestartPolicy({ maxAttempts: 5 }) }),
  };
}

function useForceKill(fake: FakeRuntime, autoExitOnKill: "sigkill" | "never" = "sigkill"): void {
  fake.setSpawn((command, options) => {
    const proc = new FakeProcess({ pid: 2_000 + fake.processes.length, autoExitOnKill });
    proc.onExit = options?.onExit;
    fake.processes.push(proc);
    fake.spawnCalls.push({ command, options });
    return proc;
  });
}

describe("ProcessSupervisor command/termination snapshot", () => {
  test("buildClientArgs preserves insertion order and reserved failures", () => {
    expect(buildClientArgs({ token: "abc", mode: "fast" })).toEqual(["--token", "abc", "--mode", "fast"]);
    expect(() => buildClientArgs({ secret: "x" })).toThrow("clientArgs.secret is reserved and managed by Gateway");
    expect(() => buildClientArgs({ port: "1" })).toThrow("clientArgs.port is reserved and managed by Gateway");
    expect(() => buildClientArgs({ "gateway-url": "x" })).toThrow("clientArgs.gateway-url is reserved and managed by Gateway");
    expect(buildClientArgs()).toEqual([]);
  });

  test("buildClientCommand keeps the fixed secret/port/gateway order", () => {
    const client = { id: "bot", platform: "telegram", secret: "s3", port: 4_200, url: "http://127.0.0.1:4200" };
    expect(buildClientCommand({ ...CLIENT, clientArgs: { token: "t", mode: "fast" } }, client, 3_000)).toEqual([
      "/bin/bot", "--secret", "s3", "--port", "4200", "--gateway-url", "http://127.0.0.1:3000",
      "--token", "t", "--mode", "fast",
    ]);
  });

  test("spawn passes env/stdin/stdout/stderr/onExit and logs the exit", async () => {
    const fake = createFakeRuntime();
    const { supervisor, entries } = createSupervisor(fake);
    await supervisor.start();
    const call = fake.spawnCalls[0]!;
    expect(call.command).toEqual(["/bin/bot", "--secret", supervisor.active!.secret, "--port", "4200",
      "--gateway-url", "http://127.0.0.1:3000"]);
    expect(call.options).toMatchObject({ stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    expect(call.options?.env).toBeObject();
    expect(typeof call.options?.onExit).toBe("function");
    expect(entries.find(entry => entry.message === "spawning client")?.context).toMatchObject({
      id: "bot", platform: "telegram", port: 4_200, binary: "/bin/bot", stdio: "ignore" });

    const proc = fake.processes[0]!;
    proc.exit(7);
    await fake.clock.flush();
    expect(entries.find(entry => entry.message === "client exited")?.context).toMatchObject({
      id: "bot", platform: "telegram", exitCode: 7, signalCode: null, error: undefined });
    expect(supervisor.active).toBeUndefined();
    expect(supervisor.isRunning).toBe(false);
  });

  test("stdio defaults to inherit", async () => {
    const fake = createFakeRuntime();
    const { supervisor } = createSupervisor(fake, { id: "bot", platform: "telegram", binary: "/bin/bot", stdio: undefined } as unknown as ClientConfig);
    await supervisor.start();
    expect(fake.spawnCalls[0]?.options).toMatchObject({ stdout: "inherit", stderr: "inherit" });
  });

  test("graceful stop sends SIGTERM once and logs the exit code", async () => {
    const fake = createFakeRuntime();
    const { supervisor, entries } = createSupervisor(fake);
    await supervisor.start();
    const proc = fake.processes[0]!;
    await supervisor.stop();
    expect(proc.killSignals).toEqual(["SIGTERM"]);
    expect(entries.find(entry => entry.message === "client terminated gracefully")?.context).toMatchObject({ id: "bot", pid: proc.pid, exitCode: 0 });
    expect(supervisor.active).toBeUndefined();
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("force stop waits the grace period before SIGKILL", async () => {
    const fake = createFakeRuntime();
    useForceKill(fake);
    const { supervisor, entries } = createSupervisor(fake);
    await supervisor.start();
    const proc = fake.processes[0]!;
    const stopped = supervisor.stop();
    await fake.clock.advance(4_999);
    expect(proc.killSignals).toEqual(["SIGTERM"]);
    await fake.clock.advance(1);
    await stopped;
    expect(proc.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(entries.map(entry => entry.message)).toContain("client did not exit gracefully, force killing");
    expect(entries.find(entry => entry.message === "client killed")?.context).toMatchObject({ id: "bot", pid: proc.pid });
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("reports a failed force kill after the force timeout", async () => {
    const fake = createFakeRuntime();
    useForceKill(fake, "never");
    const { supervisor } = createSupervisor(fake);
    await supervisor.start();
    const stopped = supervisor.stop().then(() => null, (error: Error) => error);
    await fake.clock.advance(8_000);
    const error = await stopped;
    expect(error?.message).toBe(`Failed to kill client bot (${fake.processes[0]!.pid})`);
    expect(fake.clock.pendingTimers).toBe(0);
  });
});
