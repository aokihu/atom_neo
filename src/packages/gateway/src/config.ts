import { z } from "zod";

const ClientConfigSchema = z.object({
  id: z.string().min(1),
  platform: z.string().min(1),
  binary: z.string().min(1),
  clientArgs: z.record(z.string(), z.string()).optional(),
  stdio: z.enum(["inherit", "ignore"]).default("inherit"),
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;

const GatewayConfigSchema = z.object({
  port: z.number().int().default(3000),
  host: z.string().default("0.0.0.0"),
  coreUrl: z.string().default("http://localhost:3100"),
  jwtSecret: z.string().min(16).default("change-me-minimum-16-chars"),
  rateLimitEnabled: z.boolean().default(true),
  rateLimitRequestsPerMin: z.number().int().default(60),
  rateLimitBurst: z.number().int().default(10),
  clients: z.array(ClientConfigSchema).default([]),
  clientPortRangeStart: z.number().int().default(4200),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export function loadGatewayConfig(overrides?: Partial<GatewayConfig>): GatewayConfig {
  const env: Record<string, unknown> = {};
  if (Bun.env.GATEWAY_PORT) env.port = parseInt(Bun.env.GATEWAY_PORT);
  if (Bun.env.CORE_URL) env.coreUrl = Bun.env.CORE_URL;
  if (Bun.env.JWT_SECRET) env.jwtSecret = Bun.env.JWT_SECRET;

  return GatewayConfigSchema.parse({ ...env, ...overrides });
}
