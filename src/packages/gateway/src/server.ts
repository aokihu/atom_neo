import { Logger, LogHub, StdoutSink, createHttpServer, isAdminRequest } from "@atom-neo/shared";
import type { HttpServer } from "@atom-neo/shared";
import { loadGatewayConfig } from "./config";
import type { GatewayConfig } from "./config";
import type { ResolvedClientConfig } from "./client-package/resolver";
import { SECRET_HEADER } from "./auth/secret";
import { ClientManager } from "./client-manager";
import type { ActiveClient } from "./client-manager";
import { DiagnosticsStore, readClientDiagnostics } from "./client-manager/diagnostics";
import type { DiagnosticEvent, DiagnosticStage } from "./client-manager/diagnostics";
import type { ClientManagerRuntime } from "./client-manager/runtime";

const DRAIN_TIMEOUT_MS = 30_000;
const DRAIN_POLL_MS = 50;
const MAX_DIAGNOSTIC_MESSAGE = 300;
const SECRET_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

type InboundMessage = {
  type: "message";
  platform: string;
  platformUserId: string;
  data: { text: string };
};

type InboundEvent = {
  type: "status";
  platform: string;
  platformUserId: string;
  status: "connected" | "disconnected";
};

export type GatewayOverrides = Partial<GatewayConfig> & {
  adminToken?: string;
  logger?: Logger;
  httpServer?: HttpServer;
  resolvedClients?: readonly ResolvedClientConfig[];
  clientRuntime?: ClientManagerRuntime;
  resolveClient?: (id: string) => Promise<ResolvedClientConfig>;
  drainTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export async function startGateway(configOverrides?: GatewayOverrides): Promise<{ port: number; stop: () => Promise<void> }> {
  const config = loadGatewayConfig(configOverrides);
  const resolvedClients = configOverrides?.resolvedClients ?? [];
  if (config.clients.length > 0) {
    if (configOverrides?.resolvedClients === undefined) {
      throw new Error("Gateway clients must be resolved before starting; pass resolvedClients from bootstrap");
    }
    if (resolvedClients.length !== config.clients.length || resolvedClients.some((client, index) => client.id !== config.clients[index]!.id)) {
      throw new Error("Gateway resolvedClients must match configured client IDs");
    }
  }
  const logger = configOverrides?.logger ?? new Logger("info", () => {});
  const httpServer = configOverrides?.httpServer ?? await createHttpServer();
  const cm = new ClientManager(config, resolvedClients, logger, configOverrides?.clientRuntime);
  const fetchImpl = configOverrides?.fetchImpl ?? fetch;
  const resolveClient = configOverrides?.resolveClient;
  const drainTimeoutMs = Math.max(0, configOverrides?.drainTimeoutMs ?? DRAIN_TIMEOUT_MS);
  const diagnostics = new DiagnosticsStore();
  let stopping = false;

  // Per-client rate limiting: max 1 request per 200ms per client
  const rateLimiters = new Map<string, number>();

  // Drain is service-layer state: only /gateway/inbound counts as in-flight work.
  const inFlight = new Map<string, number>();
  const draining = new Set<string>();

  logger.info("gateway starting", { port: config.port, coreUrl: config.coreUrl, clientCount: resolvedClients.length });

  function message(value: unknown): string {
    const text = (value instanceof Error ? value.message : String(value)).replace(SECRET_PATTERN, "[redacted]");
    return text.replace(/\s+/g, " ").trim().slice(0, MAX_DIAGNOSTIC_MESSAGE);
  }

  function record(id: string, stage: DiagnosticStage, level: DiagnosticEvent["level"], text: unknown): void {
    diagnostics.record(id, { stage, level, message: message(text) });
  }

  function label(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const text = message(value);
    return text ? text.slice(0, 64) : undefined;
  }

  function cacheBypass(id: string): boolean {
    const last = rateLimiters.get(id) ?? 0;
    if (Date.now() - last < 200) return true;
    rateLimiters.set(id, Date.now());
    return false;
  }

  function beginInbound(id: string): boolean {
    if (draining.has(id)) return false;
    inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
    return true;
  }

  function endInbound(id: string): void {
    const count = (inFlight.get(id) ?? 1) - 1;
    if (count <= 0) inFlight.delete(id);
    else inFlight.set(id, count);
  }

  async function waitDrained(id: string): Promise<boolean> {
    const deadline = Date.now() + drainTimeoutMs;
    while ((inFlight.get(id) ?? 0) > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await sleep(Math.min(DRAIN_POLL_MS, remaining));
    }
    return true;
  }

  async function handleInbound(client: ActiveClient, req: Request): Promise<Response> {
    try {
      let body: unknown;
      try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

      const msg = body as InboundMessage;
      const text = msg?.data?.text;
      if (!msg.platform || !msg.platformUserId || typeof text !== "string") {
        return Response.json({ error: "Invalid inbound message: platform, platformUserId, and data.text are required" }, { status: 400 });
      }

      logger.info("inbound message", { client: client.id, platform: msg.platform, user: msg.platformUserId, text: text.slice(0, 50) });
      const sessionId = `${client.platform}:${msg.platformUserId}`;

      const taskRes = await fetchImpl(`${config.coreUrl}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId, chatId: sessionId, pipeline: "conversation",
          platform: client.platform,
          initiator: { type: "gateway", clientId: client.id, platform: client.platform },
          data: { text },
        }),
      });
      if (!taskRes.ok) throw new Error(`Core rejected task (${taskRes.status})`);
      const taskData = await taskRes.json() as { taskId: string };
      logger.debug("task submitted", { taskId: taskData.taskId });

      const result = await pollTask(taskData.taskId);
      logger.debug("task completed, pushing to client", { taskId: taskData.taskId });

      try {
        const res = await fetchImpl(`${client.url}/task-result`, {
          method: "POST",
          headers: { "Content-Type": "application/json", [SECRET_HEADER]: client.secret },
          body: JSON.stringify({ taskId: taskData.taskId, platformUserId: msg.platformUserId, result }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          record(client.id, "delivery", "error", `Client rejected task result (${res.status})`);
          logger.error("client rejected task result", { taskId: taskData.taskId, clientId: client.id, status: res.status });
        }
      } catch (err) {
        record(client.id, "delivery", "error", `Task result push failed: ${message(err)}`);
        logger.error("failed to push task result to client", { taskId: taskData.taskId, clientId: client.id, error: String(err) });
      }

      return Response.json({ ok: true });
    } catch (err) {
      const text = message(err);
      record(client.id, "delivery", "error", `Inbound failed: ${text}`);
      logger.error("inbound error", { error: text });
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  }

  async function pollTask(taskId: string, timeoutMs = 120_000): Promise<unknown> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await fetchImpl(`${config.coreUrl}/api/tasks/${taskId}`);
      if (!res.ok) { await sleep(200); continue; }
      const status = await res.json() as { state: string; result?: unknown; error?: string };
      if (status.state === "completed") return status.result;
      if (status.state === "failed") throw new Error(status.error ?? "task failed");
      await sleep(200);
    }
    throw new Error("task timeout");
  }

  async function reloadClient(id: string): Promise<Response> {
    if (!resolveClient) return Response.json({ error: "Reload unsupported" }, { status: 501 });
    if (draining.has(id)) return Response.json({ error: "Client busy" }, { status: 409 });

    draining.add(id);
    try {
      if (!await waitDrained(id)) return Response.json({ error: "Client busy" }, { status: 409 });
      const resolved = await resolveClient(id);
      await cm.reload(id, resolved);
      record(id, "process", "info", "reloaded");
      return Response.json({ results: [{ id, ok: true }], clients: cm.list() });
    } catch (error) {
      const text = message(error);
      record(id, "process", "error", `reload failed: ${text}`);
      return Response.json({ results: [{ id, ok: false, error: text }], clients: cm.list() }, { status: 400 });
    } finally {
      draining.delete(id);
    }
  }

  const handle = await httpServer.serve({
    port: config.port,
    host: config.host,
    async fetch(req, ctx) {
      const url = new URL(req.url);

      if (url.pathname === "/admin/clients" || url.pathname.startsWith("/admin/clients/")) {
        if (!isAdminRequest(req, ctx, configOverrides?.adminToken)) return Response.json({ error: "Forbidden" }, { status: 403 });
        if (stopping) return Response.json({ error: "Gateway stopping" }, { status: 503 });

        if (url.pathname === "/admin/clients" && req.method === "GET") {
          return Response.json({
            clients: cm.status().map(({ active, ...status }) => ({
              ...status,
              active: active && { id: active.id, platform: active.platform, port: active.port, url: active.url },
              diagnostics: diagnostics.summary(status.id),
            })),
          });
        }

        const diagnosticsMatch = /^\/admin\/clients\/([^/]+)\/diagnostics$/.exec(url.pathname);
        if (diagnosticsMatch && req.method === "GET") {
          const id = decodeURIComponent(diagnosticsMatch[1]!);
          const status = cm.status().find((client) => client.id === id);
          if (!status) return Response.json({ error: "Unknown client" }, { status: 404 });
          const client = status.active
            ? await readClientDiagnostics(status.active, fetchImpl)
            : { status: "unreachable" as const, error: "Client not running" };
          return Response.json({ id, state: status.state, events: diagnostics.list(id), client });
        }

        if (url.pathname === "/admin/clients" && req.method === "POST") {
          const body = await req.json().catch(() => null) as { action?: string; clientId?: string } | null;
          const action = body?.action;
          const validId = body?.clientId === undefined || (typeof body.clientId === "string" && body.clientId.trim() !== "");
          if (!body || !["start", "stop", "reload"].includes(action ?? "") || !validId) {
            return Response.json({ error: "Expected action start|stop|reload and clientId for reload" }, { status: 400 });
          }
          if (action === "reload") {
            if (typeof body.clientId !== "string") return Response.json({ error: "reload requires clientId" }, { status: 400 });
            return reloadClient(body.clientId);
          }

          const ids = body.clientId === undefined ? cm.list().map(c => c.id) : [body.clientId];
          const results = [];
          for (const id of ids) {
            try {
              if (action === "start") { await cm.start(id); record(id, "process", "info", "started"); }
              else { await cm.stop(id); record(id, "process", "info", "stopped"); }
              results.push({ id, ok: true });
            } catch (error) {
              record(id, "process", "error", `${action} failed: ${message(error)}`);
              results.push({ id, ok: false, error: message(error) });
            }
          }
          return Response.json({ results, clients: cm.list() }, { status: results.every(r => r.ok) ? 200 : 400 });
        }

        return new Response("Not Found", { status: 404 });
      }

      if (url.pathname.startsWith("/gateway/")) {
        if (stopping) return Response.json({ error: "Gateway stopping" }, { status: 503 });
        const secret = req.headers.get(SECRET_HEADER);
        const client = secret ? cm.getBySecret(secret) : null;

        if (!client) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { "Content-Type": "application/json" },
          });
        }

        if (url.pathname === "/gateway/inbound" && req.method === "POST") {
          if (!beginInbound(client.id)) return Response.json({ error: "Client busy" }, { status: 503 });
          try {
            // Rate limit after the drain check so a draining instance answers 503, not 429.
            if (cacheBypass(client.id)) {
              return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
                status: 429, headers: { "Content-Type": "application/json" },
              });
            }
            return await handleInbound(client, req);
          } finally {
            endInbound(client.id);
          }
        }

        if (cacheBypass(client.id)) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
            status: 429, headers: { "Content-Type": "application/json" },
          });
        }

        if (url.pathname === "/gateway/event" && req.method === "POST") {
          const body = await req.json().catch(() => null) as { type?: unknown; status?: unknown } | null;
          const type = label(body?.type) ?? "event";
          const status = label(body?.status);
          const level = status === "disconnected" || status === "error" ? "warn" : "info";
          record(client.id, "platform", level, `event ${type}${status ? `: ${status}` : ""}`);
          logger.info("client event", { client: client.id, type, status });
          return Response.json({ ok: true });
        }

        return new Response("Not Found", { status: 404 });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  config.port = handle.port;
  try {
    await cm.startAll();
    for (const client of cm.status()) record(client.id, "process", "info", "started");
  } catch (error) {
    for (const client of cm.status()) {
      if (!client.running) record(client.id, "process", "error", `start failed: ${message(error)}`);
    }
    try { await cm.stopAll(); } finally { await handle.stop(true); }
    throw error;
  }
  logger.info("gateway ready", { port: handle.port });

  let stopPromise: Promise<void> | undefined;
  return { port: handle.port, stop: () => stopPromise ??= (async () => {
    stopping = true;
    await handle.stop(false);
    try { await cm.stopAll(); } finally { await handle.stop(true); }
  })() };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

if (import.meta.main) {
  const logHub = new LogHub();
  logHub.addSink(new StdoutSink());
  const logger = new Logger("info", (entry) => logHub.write(entry));
  startGateway({ logger });
}
