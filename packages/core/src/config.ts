import { z } from "zod";

const CoreConfigSchema = z.object({
  port: z.number().int().default(3100),
  host: z.string().default("0.0.0.0"),
  logLevel: z.number().int().min(1).max(3).default(1),
  logFile: z.string().optional(),
  memoryDbPath: z.string().default("./data/memory.db"),
  maxSessions: z.number().int().default(1000),
  taskTimeoutMs: z.number().int().default(120_000),
  replayEnabled: z.boolean().default(false),
  replayMaxEvents: z.number().int().default(10_000),
  transportModel: z.string().default("deepseek/deepseek-chat"),
  transportMaxOutputTokens: z.number().int().default(4096),
});

export type CoreConfig = z.infer<typeof CoreConfigSchema>;

export function loadCoreConfig(): CoreConfig {
  const envConfig: Partial<Record<string, unknown>> = {};

  if (process.env.CORE_PORT) envConfig.port = parseInt(process.env.CORE_PORT);
  if (process.env.CORE_HOST) envConfig.host = process.env.CORE_HOST;
  if (process.env.LOG_LEVEL) envConfig.logLevel = parseInt(process.env.LOG_LEVEL);
  if (process.env.TRANSPORT_MODEL) envConfig.transportModel = process.env.TRANSPORT_MODEL;
  if (process.env.MEMORY_DB_PATH) envConfig.memoryDbPath = process.env.MEMORY_DB_PATH;

  const cliConfig = parseCliArgs();

  return CoreConfigSchema.parse({ ...envConfig, ...cliConfig });
}

function parseCliArgs(): Partial<Record<string, unknown>> {
  const args = Bun.argv.slice(2);
  const config: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--port":
        config.port = parseInt(args[++i]);
        break;
      case "--host":
        config.host = args[++i];
        break;
      case "--log-level":
        config.logLevel = parseInt(args[++i]);
        break;
    }
  }

  return config;
}
