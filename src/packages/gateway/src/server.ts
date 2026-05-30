import { loadGatewayConfig } from "./config";
import { JwtVerifier } from "./auth/jwt";
import { RateLimiter } from "./ratelimit/limiter";
import { CoreProxy } from "./proxy/core-proxy";
import { Logger, LogHub, StdoutSink } from "@atom-neo/shared";

const logHub = new LogHub();
logHub.addSink(new StdoutSink());
const logger = new Logger("info", (entry) => logHub.write(entry));

export async function startGateway(): Promise<void> {
  const config = loadGatewayConfig();
  const jwt = new JwtVerifier(config.jwtSecret);
  const limiter = new RateLimiter({
    maxRequests: config.rateLimitRequestsPerMin,
    burst: config.rateLimitBurst,
  });
  const proxy = new CoreProxy(config.coreUrl);

  logger.info("gateway starting", { port: config.port, coreUrl: config.coreUrl });

  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    async fetch(req) {
      const ip = server.requestIP(req)?.address ?? "unknown";

      const token = req.headers.get("Authorization")?.replace("Bearer ", "");
      const payload = token ? await jwt.verify(token) : null;

      if (!payload) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!limiter.allow(payload.sub)) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }

      return proxy.proxy(req);
    },
  });

  logger.info("gateway ready", { port: server.port });
}

if (import.meta.main) {
  startGateway();
}
