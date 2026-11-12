/** ProcessSupervisor lifecycle, restart and concurrency tests with fake runtime. */
import { describe, expect, test } from "bun:test";
import { Logger } from "@atom-neo/shared";
import type { ClientConfig } from "../config";
import { HealthProbe } from "./health-probe";
import { buildClientArgs, ProcessSupervisor } from "./process-supervisor";
import { RestartPolicy } from "./restart-policy";
import { createFakeRuntime, FakeProcess } from "./test-helpers";
import type { FakeRuntime } from "./test-helpers";

const CLIENT: ClientConfig = {
  id: "bot",
  platform: "telegram",
  binary: "/bin/bot",
  stdio: "ignore",
};

function createSupervisor(fake: FakeRuntime, options: { maxAttempts?: number; policy?: RestartPolicy } = {}): ProcessSupervisor {
  return new ProcessSupervisor({
    id: CLIENT.id,
    config: CLIENT,
    port: 4_200,
    gatewayPort: 3_000,
    logger: new Logger("error", () => {}),
    runtime: fake.runtime,
    probe: new HealthProbe({
      fetch: fake.runtime.fetch,
      setTimeout: fake.runtime.setTimeout,
      clearTimeout: fake.runtime.clearTimeout,
      timeoutMs: 500,
    }),
    policy: options.policy ?? new RestartPolicy({ maxAttempts: options.maxAttempts ?? 5 }),
  });
}

function useForceKill(fake: FakeRuntime): void {
  fake.setSpawn((command, options) => {
    const proc = new FakeProcess({ pid: 2_000 + fake.processes.length, autoExitOnKill: "sigkill" });
    proc.onExit = options?.onExit;
    fake.processes.push(proc);
    fake.spawnCalls.push({ command, options });
    return proc;
  });
}

describe("ProcessSupervisor", () => {
  test("rejects reserved client arguments", () => {
    expect(() => buildClientArgs({ secret: "x" })).toThrow("clientArgs.secret is reserved and managed by Gateway");
    expect(() => buildClientArgs({ port: "1" })).toThrow("clientArgs.port is reserved and managed by Gateway");
    expect(buildClientArgs({ token: "abc" })).toEqual(["--token", "abc"]);
  });

  test("starts a client and exposes the active secret and port", async () => {
    const fake = createFakeRuntime();
    const supervisor = createSupervisor(fake);

    await supervisor.start();

    expect(supervisor.state).toBe("running");
    expect(supervisor.desired).toBe(true);
    expect(supervisor.isRunning).toBe(true);
    expect(supervisor.active).toEqual({
      id: "bot",
      platform: "telegram",
      secret: expect.any(String),
      port: 4_200,
      url: "http://127.0.0.1:4200",
    });
    expect(fake.spawnCalls).toHaveLength(1);
    expect(fake.spawnCalls[0]?.command).toEqual([
      "/bin/bot",
      "--secret", supervisor.active!.secret,
      "--port", "4200",
      "--gateway-url", "http://127.0.0.1:3000",
    ]);
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("fails start when spawn throws", async () => {
    const fake = createFakeRuntime();
    fake.setSpawn(() => { throw new Error("spawn failed"); });
    const supervisor = createSupervisor(fake);

    const error = await supervisor.start().then(() => null, (reason: Error) => reason);

    expect(error?.message).toBe("spawn failed");
    expect(supervisor.state).toBe("failed");
    expect(supervisor.desired).toBe(false);
    expect(supervisor.active).toBeUndefined();
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("fails start when readiness times out", async () => {
    const fake = createFakeRuntime();
    fake.setFetch(async () => new Response("not ready", { status: 503 }));
    const supervisor = createSupervisor(fake);

    const pending = supervisor.start().then(() => null, (reason: Error) => reason);
    await fake.clock.advance(10_000);
    const error = await pending;

    expect(error?.message).toBe("Client bot health check timed out");
    expect(supervisor.state).toBe("failed");
    expect(supervisor.active).toBeUndefined();
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("stops gracefully with SIGTERM", async () => {
    const fake = createFakeRuntime();
    const supervisor = createSupervisor(fake);
    await supervisor.start();
    const proc = fake.processes[0]!;

    await supervisor.stop();

    expect(supervisor.state).toBe("idle");
    expect(supervisor.desired).toBe(false);
    expect(supervisor.active).toBeUndefined();
    expect(proc.killSignals).toEqual(["SIGTERM"]);
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("force kills when the process ignores SIGTERM", async () => {
    const fake = createFakeRuntime();
    useForceKill(fake);
    const supervisor = createSupervisor(fake);
    await supervisor.start();
    const proc = fake.processes[0]!;

    const stopped = supervisor.stop();
    await fake.clock.advance(5_000);
    await stopped;

    expect(proc.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(supervisor.state).toBe("idle");
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("treats duplicate stop as idempotent", async () => {
    const fake = createFakeRuntime();
    const supervisor = createSupervisor(fake);
    await supervisor.start();
    const proc = fake.processes[0]!;

    await Promise.all([supervisor.stop(), supervisor.stop()]);

    expect(proc.killSignals).toEqual(["SIGTERM"]);
    expect(supervisor.state).toBe("idle");
  });

  test("restarts after an unexpected exit with a new secret", async () => {
    const fake = createFakeRuntime();
    const supervisor = createSupervisor(fake);
    await supervisor.start();
    const first = fake.processes[0]!;
    const firstSecret = supervisor.active?.secret;

    first.exit(1);
    await fake.clock.flush();

    expect(supervisor.state).toBe("failed");
    expect(supervisor.desired).toBe(true);
    expect(supervisor.active).toBeUndefined();
    expect(fake.clock.pendingTimers).toBe(1);

    await fake.clock.advance(1_000);

    expect(supervisor.state).toBe("running");
    expect(fake.processes).toHaveLength(2);
    expect(supervisor.active?.secret).not.toBe(firstSecret);
  });

  test("restarts after a health failure through the same path", async () => {
    const fake = createFakeRuntime();
    const supervisor = createSupervisor(fake);
    await supervisor.start();
    const first = fake.processes[0]!;
    fake.setFetch(async () => new Response("unhealthy", { status: 500 }));

    expect(await supervisor.checkHealth()).toBe("unhealthy");
    expect(supervisor.state).toBe("failed");
    await fake.clock.flush();
    expect(fake.clock.pendingTimers).toBe(1);
    fake.setFetch(async () => new Response("ok", { status: 200 }));

    await fake.clock.advance(1_000);

    expect(first.killSignals).toEqual(["SIGTERM"]);
    expect(supervisor.state).toBe("running");
    expect(fake.processes).toHaveLength(2);
  });

  test("does not restart after a manual stop", async () => {
    const fake = createFakeRuntime();
    const supervisor = createSupervisor(fake);
    await supervisor.start();
    const proc = fake.processes[0]!;

    await supervisor.stop();
    proc.exit(1);
    await fake.clock.advance(60_000);

    expect(fake.processes).toHaveLength(1);
    expect(supervisor.state).toBe("idle");
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("gives up after the restart limit", async () => {
    const fake = createFakeRuntime();
    const supervisor = createSupervisor(fake, { maxAttempts: 2 });
    await supervisor.start();

    fake.processes[0]!.exit(1);
    await fake.clock.advance(1_000);
    fake.processes[1]!.exit(1);
    await fake.clock.advance(2_000);
    fake.processes[2]!.exit(1);
    await fake.clock.flush();

    expect(fake.processes).toHaveLength(3);
    expect(supervisor.state).toBe("idle");
    expect(supervisor.desired).toBe(false);
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("clears a pending restart timer on stop", async () => {
    const fake = createFakeRuntime();
    const supervisor = createSupervisor(fake);
    await supervisor.start();
    fake.processes[0]!.exit(1);
    await fake.clock.flush();
    expect(fake.clock.pendingTimers).toBe(1);

    await supervisor.stop();
    await fake.clock.advance(60_000);

    expect(fake.processes).toHaveLength(1);
    expect(supervisor.state).toBe("idle");
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("resets restart attempts after 60s of healthy uptime", async () => {
    const fake = createFakeRuntime();
    const policy = new RestartPolicy();
    const supervisor = createSupervisor(fake, { policy });
    await supervisor.start();
    fake.processes[0]!.exit(1);
    await fake.clock.flush();
    expect(policy.attempts).toBe(1);

    await fake.clock.advance(1_000);
    await fake.clock.advance(60_000);
    expect(await supervisor.checkHealth()).toBe("healthy");

    expect(policy.attempts).toBe(0);
  });

  test("stops a client whose readiness probe is still running", async () => {
    const fake = createFakeRuntime();
    fake.setFetch(() => new Promise<Response>(() => {}));
    const supervisor = createSupervisor(fake);

    const pending = supervisor.start().then(() => null, (reason: Error) => reason);
    const stopped = supervisor.stop();
    await fake.clock.advance(500);
    const error = await pending;
    await stopped;

    expect(error?.message).toBe("Client bot stopped before ready");
    expect(supervisor.state).toBe("idle");
    expect(fake.clock.pendingTimers).toBe(0);
  });
});
