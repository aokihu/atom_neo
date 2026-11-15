/** G3 admin status, diagnostics, reload and drain tests with fake runtime/server. */
import { describe, expect, test } from "bun:test";
import { Logger } from "@atom-neo/shared";
import type { HttpServer, HttpRequestContext } from "@atom-neo/shared";
import type { ResolvedClientConfig } from "./client-package/resolver";
import { createFakeRuntime } from "./client-manager/test-helpers";
import type { FakeRuntime } from "./client-manager/test-helpers";
import type { ClientConfig } from "./config";
import { startGateway } from "./server";

const ADMIN_TOKEN = "admin-token";

const CLIENTS: ClientConfig[] = [
  { id: "alpha", directory: "./alpha", stdio: "ignore" },
  { id: "beta", directory: "./beta", stdio: "ignore" },
];

function resolved(id: string, command = `/bin/${id}`): ResolvedClientConfig {
  return {
    id,
    platform: "local",
    command: [command],
    cwd: `/tmp/${id}`,
    env: {},
    stdio: "ignore",
    source: { type: "directory", directory: `./${id}` },
  };
}

type Handler = (req: Request, ctx: HttpRequestContext) => Promise<Response>;

function captureServer(port = 4321): { server: HttpServer; stops: boolean[]; handler: () => Handler } {
  const stops: boolean[] = [];
  let handler: Handler | undefined;
  return {
    stops,
    handler: () => {
      if (!handler) throw new Error("serve() was not called");
      return handler;
    },
    server: {
      async serve(options) {
        handler = options.fetch;
        return {
          port,
          runtime: "node",
          async stop(force = false) { stops.push(force); },
        };
      },
    },
  };
}

function context(): HttpRequestContext {
  return { runtime: "node", ip: "127.0.0.1", port: 0 };
}

function admin(token = ADMIN_TOKEN): RequestInit {
  return { headers: { "x-atom-admin-token": token, "content-type": "application/json" } };
}

function secretFrom(fake: FakeRuntime, clientIndex = 0): string {
  const command = fake.spawnCalls[clientIndex]?.command ?? [];
  const index = command.indexOf("--secret");
  return command[index + 1]!;
}

function inbound(secret: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-gateway-secret": secret },
    body: JSON.stringify({ type: "message", platform: "local", platformUserId: "user", data: { text: "hi" } }),
  };
}

function coreFetch(overrides: { diagnostics?: (id: string) => Response | Promise<Response>; slow?: boolean } = {}) {
  let release: (() => void) | undefined;
  let pending = false;
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/api/tasks")) return Response.json({ taskId: "task-1" });
    if (url.endsWith("/api/tasks/task-1") || url.endsWith("/api/tasks/slow")) {
      if (overrides.slow) {
        pending = true;
        await new Promise<void>((resolve) => { release = resolve; });
      }
      return Response.json({ state: "completed", result: "ok" });
    }
    if (url.includes("/task-result")) return Response.json({ ok: true });
    if (url.includes("/diagnostics")) {
      const id = new URL(url).port === "4200" ? "alpha" : "beta";
      return overrides.diagnostics?.(id) ?? new Response("missing", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  };
  return {
    impl: impl as typeof fetch,
    pending: () => pending,
    release: () => release?.(),
  };
}

async function start(fake: FakeRuntime, server: HttpServer, fetchImpl: typeof fetch, options: {
  resolveClient?: (id: string) => Promise<ResolvedClientConfig>;
  drainTimeoutMs?: number;
} = {}) {
  return startGateway({
    port: 0,
    clients: CLIENTS,
    resolvedClients: [resolved("alpha"), resolved("beta")],
    adminToken: ADMIN_TOKEN,
    clientRuntime: fake.runtime,
    httpServer: server,
    fetchImpl,
    logger: new Logger("error", () => {}),
    ...options,
  });
}

describe("Gateway admin and drain", () => {
  test("GET /admin/clients requires the admin token and returns secret-free status", async () => {
    const fake = createFakeRuntime();
    const captured = captureServer();
    const fetchImpl = coreFetch().impl;
    const gateway = await start(fake, captured.server, fetchImpl);
    try {
      const handler = captured.handler();
      expect((await handler(new Request("http://gateway/admin/clients"), context())).status).toBe(403);

      const response = await handler(new Request("http://gateway/admin/clients", admin()), context());
      expect(response.status).toBe(200);
      const body = await response.json() as { clients: Array<Record<string, unknown>> };
      expect(body.clients.map(client => client.id)).toEqual(["alpha", "beta"]);
      expect(body.clients[0]).toMatchObject({ running: true, state: "running", port: 4200, platform: "local" });
      expect(JSON.stringify(body)).not.toContain(secretFrom(fake));
      expect(body.clients[0]?.diagnostics).toBeArray();
    } finally {
      await gateway.stop();
    }
  });

  test("GET diagnostics maps 404/ok/failure and never probes /health", async () => {
    const calls: string[] = [];
    const fake = createFakeRuntime();
    const captured = captureServer();
    const core = coreFetch({
      diagnostics: (id) => {
        if (id === "alpha") return new Response("missing", { status: 404 });
        return Response.json({ checks: [{ name: "local.check", ok: true }] });
      },
    });
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(String(input));
      return core.impl(input, init);
    }) as typeof fetch;
    const gateway = await start(fake, captured.server, fetchImpl);
    try {
      const handler = captured.handler();
      const unknown = await handler(new Request("http://gateway/admin/clients/ghost/diagnostics", admin()), context());
      expect(unknown.status).toBe(404);

      const alpha = await handler(new Request("http://gateway/admin/clients/alpha/diagnostics", admin()), context());
      expect((await alpha.json() as { client: { status: string } }).client.status).toBe("unsupported");

      const beta = await handler(new Request("http://gateway/admin/clients/beta/diagnostics", admin()), context());
      const betaBody = await beta.json() as { client: { status: string; checks: unknown[] } };
      expect(betaBody.client.status).toBe("ok");
      expect(betaBody.client.checks).toHaveLength(1);
      expect(calls.some(url => url.endsWith("/health"))).toBe(false);
    } finally {
      await gateway.stop();
    }
  });

  test("reload requires a resolver and only replaces the target instance", async () => {
    const fake = createFakeRuntime();
    const captured = captureServer();
    const fetchImpl = coreFetch().impl;
    const withoutResolver = await start(fake, captured.server, fetchImpl);
    try {
      const response = await captured.handler()(new Request("http://gateway/admin/clients", {
        ...admin(),
        method: "POST",
        body: JSON.stringify({ action: "reload", clientId: "alpha" }),
      }), context());
      expect(response.status).toBe(501);
    } finally {
      await withoutResolver.stop();
    }

    const fake2 = createFakeRuntime();
    const captured2 = captureServer();
    const gateway = await start(fake2, captured2.server, fetchImpl, {
      resolveClient: async (id) => resolved(id, `/bin/${id}-v2`),
    });
    try {
      const betaProcess = fake2.processes[1]!;
      const response = await captured2.handler()(new Request("http://gateway/admin/clients", {
        ...admin(),
        method: "POST",
        body: JSON.stringify({ action: "reload", clientId: "alpha" }),
      }), context());
      expect(response.status).toBe(200);
      expect(fake2.processes[0]!.killSignals).toEqual(["SIGTERM"]);
      expect(fake2.processes).toHaveLength(3);
      expect(fake2.spawnCalls[2]!.command).toContain("/bin/alpha-v2");
      expect(betaProcess.killSignals).toEqual([]);
      expect(fake2.processes[1]!.killSignals).toEqual([]);
    } finally {
      await gateway.stop();
    }
  });

  test("drain blocks the target with 503, times out reload with 409 and preserves the old process", async () => {
    const fake = createFakeRuntime();
    const captured = captureServer();
    const core = coreFetch({ slow: true });
    const gateway = await start(fake, captured.server, core.impl, {
      resolveClient: async (id) => resolved(id, `/bin/${id}-v2`),
      drainTimeoutMs: 50,
    });
    const handler = captured.handler();
    try {
      const secret = secretFrom(fake);
      const first = handler(new Request("http://gateway/gateway/inbound", inbound(secret)), context());
      while (!core.pending()) await Bun.sleep(1);

      const reloading = handler(new Request("http://gateway/admin/clients", {
        ...admin(),
        method: "POST",
        body: JSON.stringify({ action: "reload", clientId: "alpha" }),
      }), context());
      await Bun.sleep(5);
      const blocked = await handler(new Request("http://gateway/gateway/inbound", inbound(secret)), context());
      expect(blocked.status).toBe(503);

      const reload = await reloading;
      expect(reload.status).toBe(409);
      expect(fake.processes[0]!.killSignals).toEqual([]);

      core.release();
      expect((await first).status).toBe(200);

      const next = await handler(new Request("http://gateway/admin/clients", {
        ...admin(),
        method: "POST",
        body: JSON.stringify({ action: "reload", clientId: "alpha" }),
      }), context());
      expect(next.status).toBe(200);
      expect(fake.processes[0]!.killSignals).toEqual(["SIGTERM"]);
      expect(fake.processes[1]!.killSignals).toEqual([]);
    } finally {
      await gateway.stop();
    }
  });

  test("reload failure keeps the old target and the other instance running", async () => {
    const fake = createFakeRuntime();
    const captured = captureServer();
    const gateway = await start(fake, captured.server, coreFetch().impl, {
      resolveClient: async (id) => {
        if (id === "alpha") throw new Error("manifest changed");
        return resolved(id);
      },
    });
    try {
      const response = await captured.handler()(new Request("http://gateway/admin/clients", {
        ...admin(),
        method: "POST",
        body: JSON.stringify({ action: "reload", clientId: "alpha" }),
      }), context());
      expect(response.status).toBe(400);
      const list = await captured.handler()(new Request("http://gateway/admin/clients", admin()), context());
      const body = await list.json() as { clients: Array<{ id: string; running: boolean }> };
      expect(body.clients.map(({ id, running }) => ({ id, running }))).toEqual([
        { id: "alpha", running: true },
        { id: "beta", running: true },
      ]);
      expect(fake.processes[0]!.killSignals).toEqual([]);
      expect(fake.processes[1]!.killSignals).toEqual([]);
    } finally {
      await gateway.stop();
    }
  });
});
