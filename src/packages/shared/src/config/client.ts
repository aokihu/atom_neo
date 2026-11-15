import { z } from "zod";

/** Gateway client package reference: package id plus a pinned version. */
const ClientPackageRefSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
}).strict();

const ClientConfigBaseSchema = z.object({
  id: z.string().min(1),
  package: ClientPackageRefSchema.optional(),
  directory: z.string().min(1).optional(),
  clientArgs: z.record(z.string(), z.string()).optional(),
  /** field -> sandbox .env variable name, e.g. botToken -> ATOM_CLIENT_BOT_BOT_TOKEN */
  credentials: z.record(z.string(), z.string()).optional(),
  stdio: z.enum(["inherit", "ignore"]).default("inherit"),
});

type ClientConfigData = z.infer<typeof ClientConfigBaseSchema>;

const KNOWN_CLIENT_KEYS = new Set(Object.keys(ClientConfigBaseSchema.shape));
const LEGACY_CLIENT_KEYS = new Map([
  ["binary", '"binary" is no longer supported; use "package" or "directory" instead'],
  ["platform", '"platform" is no longer supported; the platform comes from the package manifest'],
]);

/** Gateway client entry shared by user config and gateway runtime config. */
export const ClientConfigSchema = ClientConfigBaseSchema
  .passthrough()
  .superRefine((value, ctx) => {
    if ((value.package === undefined) === (value.directory === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: 'gateway client requires exactly one of "package" or "directory"',
        path: ["package"],
      });
    }
    for (const [key, message] of LEGACY_CLIENT_KEYS) {
      if (value[key] !== undefined) ctx.addIssue({ code: "custom", message, path: [key] });
    }
    for (const key of Object.keys(value)) {
      if (!KNOWN_CLIENT_KEYS.has(key) && !LEGACY_CLIENT_KEYS.has(key)) {
        ctx.addIssue({ code: "custom", message: `unknown gateway client field "${key}"`, path: [key] });
      }
    }
  })
  .transform((value): ClientConfigData => ({
    id: value.id,
    ...(value.package === undefined ? {} : { package: value.package }),
    ...(value.directory === undefined ? {} : { directory: value.directory }),
    ...(value.clientArgs === undefined ? {} : { clientArgs: value.clientArgs }),
    ...(value.credentials === undefined ? {} : { credentials: value.credentials }),
    stdio: value.stdio,
  }));

export type ClientConfig = z.infer<typeof ClientConfigSchema>;

export type ClientSource =
  | { type: "package"; id: string; version: string }
  | { type: "directory"; directory: string };

export function clientSource(config: ClientConfig): ClientSource {
  if (config.package) return { type: "package", id: config.package.id, version: config.package.version };
  if (config.directory) return { type: "directory", directory: config.directory };
  throw new Error(`Gateway client "${config.id}" has no package or directory source`);
}

/** Migration hint for legacy instance fields; config loaders must reject these loudly. */
export function clientConfigMigrationHint(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  if ("binary" in raw) return '"binary" is no longer supported; use "package" or "directory"';
  if ("platform" in raw) return '"platform" is no longer supported; the platform comes from the package manifest';
  return undefined;
}
