/** ClientManager facade, concurrency and timer cleanup tests with fake runtime. */
import { describe, expect, test } from "bun:test";
import { Logger } from "@atom-neo/shared";
import { loadGatewayConfig } from "../config";
import { ClientManager } from "./index";
import { createFakeRuntime, FakeProcess } from "./test-helpers";
import type { FakeRuntime } from "./test-helpers";

const CLIENTS = [
  { id: "alpha", platform: "telegram", binary: "/bin/alpha", stdio: "ignore" as const },
  { id: "beta", platform: "wechat", binary: "/bin/beta", stdio: "ignore" as const },
];

function createManager(fake: FakeRuntime): ClientManager {
  const config = loadGatewayConfig({
    port: 3_000,
    host: "127.0.0.1",
    coreUrl: "http://localhost:3100",
    clients: CLIENTS,
    clientPortRangeStart: 4_200,
  });
  return new ClientManager(config, new Logger("error", () => {}), fake.runtime);
}

function useImmortalProcesses(fake: FakeRuntime): void {
  fake.setSpawn((command, options) => {
    const proc = new FakeProcess({ pid: 3_000 + fake.processes.length, autoExitOnKill: "never" });
    proc.onExit = options?.onExit;
    fake.processes.push(proc);
    fake.spawnCalls.push({ command, options });
    return proc;
  });
}

describe("ClientManager", () => {
  test("coalesces concurrent start and stop calls", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake);

    await Promise.all([manager.start("alpha"), manager.start("alpha")]);
    expect(fake.processes).toHaveLength(1);
    expect(manager.getById("alpha")?.port).toBe(4_200);
    expect(manager.list()).toEqual([{ id: "alpha", running: true, desired: true }, { id: "beta", running: false, desired: false }]);

    await Promise.all([manager.stop("alpha"), manager.stop("alpha")]);
    expect(fake.processes[0]?.killSignals).toEqual(["SIGTERM"]);
    expect(manager.getById("alpha")).toBeUndefined();
    expect(manager.list()[0]).toEqual({ id: "alpha", running: false, desired: false });
  });

  test("serializes a start issued while stop is still running", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake);
    await manager.start("alpha");

    const stopping = manager.stop("alpha");
    const starting = manager.start("alpha");
    await Promise.all([stopping, starting]);

    expect(fake.processes).toHaveLength(2);
    expect(manager.getById("alpha")).toBeDefined();
    expect(manager.list()[0]).toEqual({ id: "alpha", running: true, desired: true });
  });

  test("starts all clients and resolves secrets until stopAll", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake);

    await manager.startAll();
    expect(fake.processes).toHaveLength(2);
    expect(fake.clock.pendingTimers).toBe(1);

    const secret = manager.getById("alpha")?.secret;
    expect(secret).toBeDefined();
    expect(manager.getBySecret(secret!)?.id).toBe("alpha");

    await manager.stopAll();
    expect(fake.clock.pendingTimers).toBe(0);
    expect(manager.getBySecret(secret!)).toBeUndefined();
    expect(manager.list().every((client) => !client.running && !client.desired)).toBe(true);

    await fake.clock.advance(60_000);
    expect(fake.processes).toHaveLength(2);
  });

  test("does not resurrect a client when stopAll races an exit", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake);
    await manager.startAll();

    fake.processes[0]!.exit(1);
    await fake.clock.flush();

    const stopping = manager.stopAll();
    await fake.clock.advance(60_000);
    await stopping;

    expect(fake.processes).toHaveLength(2);
    expect(fake.clock.pendingTimers).toBe(0);
    expect(manager.list().every((client) => !client.running && !client.desired)).toBe(true);
  });

  test("restarts clients whose heartbeat health check fails", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake);
    await manager.startAll();
    const first = fake.processes[0]!;
    fake.setFetch(async () => new Response("unhealthy", { status: 500 }));

    await fake.clock.advance(30_000);
    expect(first.killSignals).toEqual(["SIGTERM"]);
    expect(manager.list().every((client) => !client.running)).toBe(true);

    fake.setFetch(async () => new Response("ok", { status: 200 }));
    await fake.clock.advance(1_000);
    expect(fake.processes).toHaveLength(4);
    expect(manager.list().every((client) => client.running && client.desired)).toBe(true);

    await manager.stopAll();
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("rejects unknown client IDs", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake);

    expect(await manager.start("missing").then(() => null, (error: Error) => error.message)).toBe("Unknown client: missing");
    expect(await manager.stop("missing").then(() => null, (error: Error) => error.message)).toBe("Unknown client: missing");
  });

  test("reports stopAll failures as AggregateError", async () => {
    const fake = createFakeRuntime();
    useImmortalProcesses(fake);
    const manager = createManager(fake);
    await manager.start("alpha");

    const stopped = manager.stopAll().then(() => null, (error: Error) => error);
    await fake.clock.advance(8_000);
    const error = await stopped;

    expect(error).toBeInstanceOf(AggregateError);
    expect(fake.processes[0]?.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(fake.clock.pendingTimers).toBe(0);
  });
});
