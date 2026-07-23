import { loadGatewayConfig } from "./config";
import type { GatewayConfig } from "./config";
import { JwtVerifier } from "./auth/jwt";
import { RateLimiter } from "./ratelimit/limiter";
import { CoreProxy } from "./proxy/core-proxy";
import { SECRET_HEADER } from "./auth/secret";
import { ClientManager } from "./client-manager";
import type { ActiveClient } from "./client-manager";
import { Logger, LogHub, StdoutSink } from "@atom-neo/shared";

const logHub = new LogHub();
logHub.addSink(new StdoutSink());
const logger = new Logger("info", (entry) => logHub.write(entry));

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

export async function startGateway(configOverrides?: Partial<GatewayConfig>): Promise<{ stop: () => void }> {
  const config = loadGatewayConfig(configOverrides);
  const jwt = new JwtVerifier(config.jwtSecret);
  const limiter = new RateLimiter({
    maxRequests: config.rateLimitRequestsPerMin,
    burst: config.rateLimitBurst,
  });
  const proxy = new CoreProxy(config.coreUrl);
  const cm = new ClientManager(config, logger);

  logger.info("gateway starting", { port: config.port, coreUrl: config.coreUrl, clientCount: config.clients.length });

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
      const sessionId = `${msg.platform}:${msg.platformUserId}`;

      const taskRes = await fetch(`${config.coreUrl}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, chatId: sessionId, pipeline: "conversation", data: { text } }),
      });
      const taskData = await taskRes.json() as { taskId: string };
      logger.debug("task submitted", { taskId: taskData.taskId });

      const result = await pollTask(taskData.taskId);
      logger.debug("task completed, pushing to client", { taskId: taskData.taskId });

      try {
        const res = await fetch(`${client.url}/task-result`, {
          method: "POST",
          headers: { "Content-Type": "application/json", [SECRET_HEADER]: client.secret },
          body: JSON.stringify({ taskId: taskData.taskId, platformUserId: msg.platformUserId, result }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          logger.error("client rejected task result", { taskId: taskData.taskId, clientId: client.id, status: res.status });
        }
      } catch (err) {
        logger.error("failed to push task result to client", { taskId: taskData.taskId, clientId: client.id, error: String(err) });
      }

      return Response.json({ ok: true });
    } catch (err) {
      logger.error("inbound error", { error: String(err) });
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  }

  async function pollTask(taskId: string, timeoutMs = 120_000): Promise<unknown> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await fetch(`${config.coreUrl}/api/tasks/${taskId}`);
      if (!res.ok) { await sleep(200); continue; }
      const status = await res.json() as { state: string; result?: unknown; error?: string };
      if (status.state === "completed") return status.result;
      if (status.state === "failed") throw new Error(status.error ?? "task failed");
      await sleep(200);
    }
    throw new Error("task timeout");
  }

  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname.startsWith("/gateway/")) {
        const secret = req.headers.get(SECRET_HEADER);
        const client = secret ? cm.getBySecret(secret) : null;

        if (!client) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { "Content-Type": "application/json" },
          });
        }

        if (url.pathname === "/gateway/inbound" && req.method === "POST") {
          return handleInbound(client, req);
        }

        if (url.pathname === "/gateway/event" && req.method === "POST") {
          try {
            const body = await req.json();
            logger.info("client event", { client: client.id, ...body });
          } catch {
            // ignore malformed event body
          }
          return Response.json({ ok: true });
        }

        return new Response("Not Found", { status: 404 });
      }

      const token = req.headers.get("Authorization")?.replace("Bearer ", "");
      const payload = token ? await jwt.verify(token) : null;

      if (!payload) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { "Content-Type": "application/json" },
        });
      }

      if (!limiter.allow(payload.sub)) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { "Content-Type": "application/json" },
        });
      }

      return proxy.proxy(req);
    },
  });

  await cm.startAll();
  logger.info("gateway ready", { port: server.port });

  return { stop: () => { server.stop(); cm.stopAll(); } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

if (import.meta.main) {
  startGateway();
}
