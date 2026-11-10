import { z } from "zod";
import { ClientConfigSchema } from "@atom-neo/shared";
import type { ClientConfig } from "@atom-neo/shared";

export type { ClientConfig };

const GatewayConfigSchema = z.object({
  port: z.number().int().min(0).max(65535).default(3000),
  host: z.string().default("127.0.0.1"),
  coreUrl: z.string().default("http://localhost:3100"),
  clients: z.array(ClientConfigSchema).default([]),
  clientPortRangeStart: z.number().int().default(4200),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export function loadGatewayConfig(overrides?: Partial<GatewayConfig>): GatewayConfig {
  const env: Record<string, unknown> = {};
  if (process.env.GATEWAY_PORT) {
    const p = Number(process.env.GATEWAY_PORT);
    if (Number.isFinite(p) && p > 0 && p <= 65535) env.port = p;
  }
  if (process.env.CORE_URL) env.coreUrl = process.env.CORE_URL;

  const config = GatewayConfigSchema.parse({ ...env, ...overrides });
  if (new Set(config.clients.map(c => c.id)).size !== config.clients.length) throw new Error("Gateway client IDs must be unique");
  if (config.clientPortRangeStart < 1 || config.clientPortRangeStart + config.clients.length > 65536) throw new Error("Invalid client port range");
  return config;
}
