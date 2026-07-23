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
  host: z.string().default("127.0.0.1"),
  coreUrl: z.string().default("http://localhost:3100"),
  clients: z.array(ClientConfigSchema).default([]),
  clientPortRangeStart: z.number().int().default(4200),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export function loadGatewayConfig(overrides?: Partial<GatewayConfig>): GatewayConfig {
  const env: Record<string, unknown> = {};
  if (Bun.env.GATEWAY_PORT) {
    const p = Number(Bun.env.GATEWAY_PORT);
    if (Number.isFinite(p) && p > 0 && p <= 65535) env.port = p;
  }
  if (Bun.env.CORE_URL) env.coreUrl = Bun.env.CORE_URL;

  return GatewayConfigSchema.parse({ ...env, ...overrides });
}
