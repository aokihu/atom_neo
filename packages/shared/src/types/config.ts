export type CoreConfig = {
  port: number;
  host: string;
  logLevel: "debug" | "info" | "warn" | "error";
};

export type GatewayConfig = {
  port: number;
  coreUrl: string;
  jwtSecret: string;
};

export type LLMConfig = {
  deepseekApiKey: string;
  openaiApiKey: string;
  transportModel: string;
};

export type MemoryConfig = {
  dbPath: string;
};

export type AppConfig = {
  core: CoreConfig;
  gateway: GatewayConfig;
  llm: LLMConfig;
  memory: MemoryConfig;
};
