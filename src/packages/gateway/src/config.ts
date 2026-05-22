import { z } from "zod";

const GatewayConfigSchema = z.object({
  port: z.number().int().default(3000),
  host: z.string().default("0.0.0.0"),
  coreUrl: z.string().default("http://localhost:3100"),
  jwtSecret: z.string().min(16).default("change-me-minimum-16-chars"),
  rateLimitEnabled: z.boolean().default(true),
  rateLimitRequestsPerMin: z.number().int().default(60),
  rateLimitBurst: z.number().int().default(10),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export function loadGatewayConfig(): GatewayConfig {
  const env: Record<string, unknown> = {};
  if (Bun.env.GATEWAY_PORT) env.port = parseInt(Bun.env.GATEWAY_PORT);
  if (Bun.env.CORE_URL) env.coreUrl = Bun.env.CORE_URL;
  if (Bun.env.JWT_SECRET) env.jwtSecret = Bun.env.JWT_SECRET;

  return GatewayConfigSchema.parse(env);
}
