/** ClientManager facade, concurrency and timer cleanup tests with fake runtime. */
import { describe, expect, test } from "bun:test";
import { Logger } from "@atom-neo/shared";
import type { ResolvedClientConfig } from "../client-package/resolver";
import { loadGatewayConfig } from "../config";
import { ClientManager } from "./index";
import { createFakeRuntime, FakeProcess } from "./test-helpers";
import type { FakeRuntime } from "./test-helpers";

const RESOLVED_CLIENTS: readonly ResolvedClientConfig[] = [
  {
    id: "alpha",
    platform: "telegram",
    command: ["/bin/alpha"],
    cwd: "/tmp/alpha",
    env: { CLIENT: "alpha" },
    stdio: "ignore",
    source: { type: "directory", directory: "./alpha" },
  },
  {
    id: "beta",
    platform: "wechat",
    command: ["/bin/beta"],
    cwd: "/tmp/beta",
    env: { CLIENT: "beta" },
    stdio: "ignore",
    source: { type: "directory", directory: "./beta" },
  },
];

const GAMMA: ResolvedClientConfig = {
  id: "gamma",
  platform: "discord",
  command: ["/bin/gamma"],
  cwd: "/tmp/gamma",
  env: { CLIENT: "gamma" },
  stdio: "ignore",
  source: { type: "directory", directory: "./gamma" },
};

function createManager(fake: FakeRuntime, clients: readonly ResolvedClientConfig[] = RESOLVED_CLIENTS): ClientManager {
  const config = loadGatewayConfig({
    port: 3_000,
    host: "127.0.0.1",
    coreUrl: "http://localhost:3100",
    clients: [],
    clientPortRangeStart: 4_200,
  });
  return new ClientManager(config, clients, new Logger("error", () => {}), fake.runtime);
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
    expect(fake.spawnCalls[0]?.command[0]).toBe("/bin/alpha");
    expect(fake.spawnCalls[0]?.options?.cwd).toBe("/tmp/alpha");
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
    expect(manager.getById("alpha")?.port).toBe(4_200);
    expect(manager.getById("beta")?.port).toBe(4_201);
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

  test("rejects unknown client IDs and duplicate resolved clients", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake);

    expect(await manager.start("missing").then(() => null, (error: Error) => error.message)).toBe("Unknown client: missing");
    expect(await manager.stop("missing").then(() => null, (error: Error) => error.message)).toBe("Unknown client: missing");
    expect(() => new ClientManager(loadGatewayConfig({ clients: [] }), [RESOLVED_CLIENTS[0]!, RESOLVED_CLIENTS[0]!],
      new Logger("error", () => {}), fake.runtime)).toThrow("Gateway client IDs must be unique");
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

  test("registers dynamic instances at the lowest free ports without starting them", () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake, []);

    manager.register(RESOLVED_CLIENTS[0]!);
    manager.register(RESOLVED_CLIENTS[1]!);

    expect(manager.status().map((client) => [client.id, client.port])).toEqual([["alpha", 4_200], ["beta", 4_201]]);
    expect(manager.list()).toEqual([
      { id: "alpha", running: false, desired: false },
      { id: "beta", running: false, desired: false },
    ]);
    expect(fake.processes).toHaveLength(0);
    expect(() => manager.register(RESOLVED_CLIENTS[0]!)).toThrow("Client already registered: alpha");
  });

  test("removes instances, releases their ports and reuses the lowest free port", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake, []);
    manager.register(RESOLVED_CLIENTS[0]!);
    manager.register(RESOLVED_CLIENTS[1]!);

    await manager.remove("alpha");
    expect(await manager.remove("alpha").then(() => null, (error: Error) => error.message)).toBe("Unknown client: alpha");
    manager.register(GAMMA);

    expect(manager.status().map((client) => [client.id, client.port])).toEqual([["beta", 4_201], ["gamma", 4_200]]);
    expect(fake.processes).toHaveLength(0);
  });

  test("reloads a running instance in place, keeping its port and desired state", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake, [RESOLVED_CLIENTS[0]!]);
    await manager.start("alpha");
    const first = fake.processes[0]!;
    const firstSecret = manager.getById("alpha")!.secret;

    await manager.reload("alpha", { ...RESOLVED_CLIENTS[0]!, command: ["/bin/alpha-v2"] });

    expect(first.killSignals).toEqual(["SIGTERM"]);
    expect(fake.processes).toHaveLength(2);
    expect(fake.spawnCalls[1]?.command[0]).toBe("/bin/alpha-v2");
    expect(manager.getById("alpha")?.port).toBe(4_200);
    expect(manager.getById("alpha")?.secret).not.toBe(firstSecret);
    expect(manager.getBySecret(firstSecret)).toBeUndefined();
    expect(manager.status()[0]).toMatchObject({
      id: "alpha", platform: "telegram", source: RESOLVED_CLIENTS[0]!.source,
      running: true, desired: true, state: "running", port: 4_200,
    });
  });

  test("reloads an idle instance without starting it", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake, [RESOLVED_CLIENTS[0]!]);

    await manager.reload("alpha", { ...RESOLVED_CLIENTS[0]!, command: ["/bin/alpha-v2"] });

    expect(fake.processes).toHaveLength(0);
    expect(fake.clock.pendingTimers).toBe(0);
    expect(manager.status()[0]).toMatchObject({
      id: "alpha", running: false, desired: false, state: "idle", port: 4_200,
    });
  });

  test("keeps other instances running when a reloaded instance fails to start", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake);
    await manager.startAll();
    const betaProcess = fake.processes[1]!;
    fake.setSpawn((command, options) => {
      if (command[0] === "/bin/alpha-v2") throw new Error("spawn failed");
      const proc = new FakeProcess({ pid: 3_000 + fake.processes.length });
      proc.onExit = options?.onExit;
      fake.processes.push(proc);
      fake.spawnCalls.push({ command, options });
      return proc;
    });

    const error = await manager.reload("alpha", { ...RESOLVED_CLIENTS[0]!, command: ["/bin/alpha-v2"] })
      .then(() => null, (reason: Error) => reason);

    expect(error?.message).toBe("spawn failed");
    expect(manager.status()[0]).toMatchObject({
      id: "alpha", running: false, desired: false, state: "failed", port: 4_200,
    });
    expect(manager.status()[1]).toMatchObject({ id: "beta", running: true, desired: true, state: "running" });
    expect(betaProcess.exitCode).toBeNull();
    expect(betaProcess.killSignals).toEqual([]);

    await manager.stopAll();
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("ignores an old process exit after reload", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake, [RESOLVED_CLIENTS[0]!]);
    await manager.start("alpha");
    const first = fake.processes[0]!;
    const lateExit = first.onExit!;

    await manager.reload("alpha", { ...RESOLVED_CLIENTS[0]!, command: ["/bin/alpha-v2"] });
    const replacement = fake.processes[1]!;
    const spawnCount = fake.spawnCalls.length;

    lateExit(0, "SIGTERM");
    await fake.clock.advance(60_000);

    expect(fake.spawnCalls).toHaveLength(spawnCount);
    expect(fake.processes).toHaveLength(2);
    expect(replacement.exitCode).toBeNull();
    expect(manager.status()[0]).toMatchObject({ running: true, desired: true, state: "running", port: 4_200 });
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("clears an old restart timer when reloading a failed instance", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake, [RESOLVED_CLIENTS[0]!]);
    await manager.start("alpha");
    fake.processes[0]!.exit(1);
    await fake.clock.flush();
    expect(fake.clock.pendingTimers).toBe(1);

    await manager.reload("alpha", { ...RESOLVED_CLIENTS[0]!, command: ["/bin/alpha-v2"] });
    expect(fake.processes).toHaveLength(2);
    expect(fake.clock.pendingTimers).toBe(0);

    const spawnCount = fake.spawnCalls.length;
    await fake.clock.advance(60_000);

    expect(fake.spawnCalls).toHaveLength(spawnCount);
    expect(fake.processes).toHaveLength(2);
    expect(manager.status()[0]).toMatchObject({ running: true, desired: true, state: "running", port: 4_200 });
  });

  test("stopAll stops dynamically registered instances and clears old supervisors", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake, []);
    manager.register(RESOLVED_CLIENTS[0]!);
    manager.register(RESOLVED_CLIENTS[1]!);
    await manager.startAll();
    const oldAlpha = fake.processes[0]!;
    const lateExit = oldAlpha.onExit!;

    await manager.reload("alpha", { ...RESOLVED_CLIENTS[0]!, command: ["/bin/alpha-v2"] });
    expect(fake.processes).toHaveLength(3);
    const newAlpha = fake.processes[2]!;
    lateExit(0, "SIGTERM");

    await manager.stopAll();

    expect(oldAlpha.killSignals).toEqual(["SIGTERM"]);
    expect(fake.processes[1]!.killSignals).toEqual(["SIGTERM"]);
    expect(newAlpha.killSignals).toEqual(["SIGTERM"]);
    expect(fake.clock.pendingTimers).toBe(0);
    expect(manager.list().every((client) => !client.running && !client.desired)).toBe(true);
    expect(manager.status().map((client) => client.id)).toEqual(["alpha", "beta"]);

    lateExit(1, null);
    await fake.clock.advance(60_000);
    expect(fake.processes).toHaveLength(3);
    expect(fake.spawnCalls).toHaveLength(3);
    expect(manager.list().every((client) => !client.running && !client.desired)).toBe(true);
  });

  test("status reports state, port, platform, source and a secret-free active projection", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake, []);
    manager.register(RESOLVED_CLIENTS[0]!);
    manager.register(RESOLVED_CLIENTS[1]!);
    await manager.start("alpha");

    const [running, idle] = manager.status();
    expect(running).toMatchObject({
      id: "alpha", platform: "telegram", source: RESOLVED_CLIENTS[0]!.source,
      running: true, desired: true, state: "running", port: 4_200,
    });
    expect(running!.active).toEqual({
      id: "alpha", platform: "telegram", port: 4_200, url: "http://127.0.0.1:4200",
    });
    expect(running!.active).not.toHaveProperty("secret");
    expect(idle).toMatchObject({
      id: "beta", platform: "wechat", source: RESOLVED_CLIENTS[1]!.source,
      running: false, desired: false, state: "idle", port: 4_201,
    });
    expect(idle!.active).toBeUndefined();

    await manager.stop("alpha");
    expect(manager.status()[0]).toMatchObject({ running: false, desired: false, state: "idle", port: 4_200 });
    expect(manager.status()[0]!.active).toBeUndefined();
  });

  test("rejects a reload config whose id does not match the target", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake, []);
    manager.register(RESOLVED_CLIENTS[0]!);
    await manager.start("alpha");

    const error = await manager.reload("alpha", { ...RESOLVED_CLIENTS[0]!, id: "other" })
      .then(() => null, (reason: Error) => reason);
    expect(error?.message).toContain("Reload config id");
    expect(manager.status()[0]).toMatchObject({ id: "alpha", running: true, port: 4_200 });
    await manager.stopAll();
  });

  test("serializes concurrent start/stop/reload for the same instance", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake, []);
    manager.register(RESOLVED_CLIENTS[0]!);
    manager.register(RESOLVED_CLIENTS[1]!);
    const next = { ...RESOLVED_CLIENTS[0]!, command: ["/bin/alpha-v2"] };

    await Promise.all([
      manager.start("alpha"),
      manager.reload("alpha", next),
      manager.stop("alpha"),
      manager.start("alpha"),
    ]);

    expect(fake.spawnCalls.map((call) => call.command[0])).toEqual(["/bin/alpha", "/bin/alpha-v2", "/bin/alpha-v2"]);
    expect(manager.status().map((client) => [client.id, client.port])).toEqual([["alpha", 4_200], ["beta", 4_201]]);
    expect(manager.status()[0]).toMatchObject({ running: true, desired: true, state: "running", port: 4_200 });
    expect(new Set(manager.status().map((client) => client.port)).size).toBe(2);

    await manager.remove("alpha");
    manager.register(GAMMA);
    expect(manager.status().map((client) => [client.id, client.port])).toEqual([["beta", 4_201], ["gamma", 4_200]]);
    expect(fake.clock.pendingTimers).toBe(0);
  });

  test("stopAll waits for an in-flight reload before snapshotting supervisors", async () => {
    const fake = createFakeRuntime();
    const manager = createManager(fake, [RESOLVED_CLIENTS[0]!]);
    await manager.start("alpha");

    let release!: (response: Response) => void;
    fake.setFetch(() => new Promise<Response>((resolve) => { release = resolve; }));
    const reloading = manager.reload("alpha", { ...RESOLVED_CLIENTS[0]!, command: ["/bin/alpha-v2"] });
    await fake.clock.advance(0);
    expect(fake.processes).toHaveLength(2);

    let stopped = false;
    const stopping = manager.stopAll().then(() => { stopped = true; });
    await fake.clock.flush();
    expect(stopped).toBe(false);

    release(new Response("ok", { status: 200 }));
    await Promise.all([reloading, stopping]);

    expect(stopped).toBe(true);
    expect(fake.clock.pendingTimers).toBe(0);
    expect(manager.list().every((client) => !client.running && !client.desired)).toBe(true);
    expect(manager.status().map((client) => client.port)).toEqual([4_200]);
  });
});
