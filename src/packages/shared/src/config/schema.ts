import { z } from "zod";
import { ClientConfigSchema } from "./client";
import {
  DEFAULT_DECISION_MODES,
  DEFAULT_PROFILES,
  ProviderDefinitionSchema,
  ProviderProfilesSchema,
} from "./providers";
import { DEFAULT_THEME, THEME_NAMES } from "./theme";

export const ConfigSchema = z.object({
  version: z.literal(2).default(2),
  providerProfiles: ProviderProfilesSchema.default({ ...DEFAULT_PROFILES }),
  providers: z.record(z.string(), ProviderDefinitionSchema).default({}),
  decisionMode: z.object({
    prediction: z.enum(["legacy", "jev"]).default(DEFAULT_DECISION_MODES.prediction),
    postConversation: z.enum(["legacy", "jev"]).default(DEFAULT_DECISION_MODES.postConversation),
    continuation: z.enum(["jev", "rules"]).default(DEFAULT_DECISION_MODES.continuation),
  }).default({ ...DEFAULT_DECISION_MODES }),
  transport: z.object({
    maxOutputTokens: z.number().int().default(4096),
  }).default({ maxOutputTokens: 4096 }),
  gateway: z.object({
    port: z.number().int().default(3000),
    clients: z.array(ClientConfigSchema).default([]),
  }).default({ port: 3000, clients: [] }),
  tui: z.object({
    theme: z.enum(THEME_NAMES).default(DEFAULT_THEME),
  }).default({ theme: DEFAULT_THEME }),
  permission: z.object({
    whitelist: z.array(z.string()).default([]),
  }).default({ whitelist: [] }),
  log: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("debug"),
    ignore: z.array(z.enum(["debug", "info", "warn", "error"])).default([]),
  }).default({ level: "debug", ignore: [] }),
  conversation: z.object({
    maxSteps: z.number().int().min(1).default(50),
    maxChainDepth: z.number().int().min(1).optional(),
    maxGlobalRounds: z.number().int().positive().optional(),
    maxLocalRounds: z.number().int().min(5).max(10).default(5),
  }).default({ maxSteps: 50, maxLocalRounds: 5 }).transform(value => ({
    ...value, maxGlobalRounds: value.maxGlobalRounds ?? (value.maxChainDepth === undefined ? 100 : value.maxChainDepth + 1),
  })),
  schedule: z.object({
    persistPath: z.string().default("schedule-tasks.json"),
  }).default({ persistPath: "schedule-tasks.json" }),
  mcpServers: z.array(z.object({
    name: z.string(),
    transport: z.discriminatedUnion("type", [
      z.object({ type: z.literal("http"), url: z.string(), headers: z.record(z.string(), z.string()).optional() }),
      z.object({ type: z.literal("sse"), url: z.string(), headers: z.record(z.string(), z.string()).optional() }),
      z.object({ type: z.literal("stdio"), command: z.string(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(), cwd: z.string().optional() }),
    ]),
  })).default([]),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

/** Objects recurse into partials; arrays/records keep full element schemas (wholesale replace). */
export function overlaySchema(schema: any): any {
  if (schema instanceof z.ZodPipe) return overlaySchema(schema.in);
  if (schema instanceof z.ZodDefault) return overlaySchema(schema.removeDefault());
  if (schema instanceof z.ZodOptional) return overlaySchema(schema.unwrap()).optional();
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, any> = {};
    for (const [key, child] of Object.entries(schema.shape)) {
      shape[key] = overlaySchema(child).optional();
    }
    return z.object(shape).strict();
  }
  if (schema instanceof z.ZodRecord) {
    return z.record(schema.keyType, overlaySchema(schema.valueType));
  }
  return schema;
}

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type RuntimeConfig = DeepPartial<Omit<AppConfig, "gateway">>;

export const RuntimeConfigSchema: z.ZodType<RuntimeConfig> = overlaySchema(
  ConfigSchema.omit({ gateway: true }),
).transform((patch: RuntimeConfig) => {
  const conversation = patch.conversation;
  return conversation?.maxChainDepth !== undefined && conversation.maxGlobalRounds === undefined
    ? { ...patch, conversation: { ...conversation, maxGlobalRounds: conversation.maxChainDepth + 1 } }
    : patch;
}) as z.ZodType<RuntimeConfig>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep merge: objects recurse, arrays/records/primitives replace wholesale. */
export function mergeConfig(base: object, overlay: object): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const prev = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(value) && isPlainObject(prev) ? mergeConfig(prev, value) : value;
  }
  return out;
}

export function runtimeConfigPath(sandboxPath: string): string {
  return `${sandboxPath}/.atom/runtime-config.json`;
}
