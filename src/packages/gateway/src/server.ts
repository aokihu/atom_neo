import { loadGatewayConfig } from "./config";
import { JwtVerifier } from "./auth/jwt";
import { RateLimiter } from "./ratelimit/limiter";
import { CoreProxy } from "./proxy/core-proxy";

export async function startGateway(): Promise<void> {
  const config = loadGatewayConfig();
  const jwt = new JwtVerifier(config.jwtSecret);
  const limiter = new RateLimiter({
    maxRequests: config.rateLimitRequestsPerMin,
    burst: config.rateLimitBurst,
  });
  const proxy = new CoreProxy(config.coreUrl);

  console.log(`Gateway starting on :${config.port} → ${config.coreUrl}`);

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

  console.log(`Gateway ready on :${server.port}`);
}

if (import.meta.main) {
  startGateway();
}
