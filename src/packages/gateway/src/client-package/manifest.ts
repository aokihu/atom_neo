import { z } from "zod";

export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const EntrySchema = z
  .strictObject({
    production: z.array(z.string().min(1)).min(1).optional(),
    development: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine((entry) => entry.production !== undefined || entry.development !== undefined, {
    message: "manifest.entry requires production or development",
  });

const ConfigFieldSchema = z
  .strictObject({
    label: z.string().min(1),
    type: z.literal("string"),
    required: z.boolean().default(false),
    secret: z.boolean().default(false),
    enum: z.array(z.string().min(1)).min(1).optional(),
    default: z.string().optional(),
    env: z.string().min(1).regex(ENV_NAME_PATTERN, "manifest.config.env must be a valid environment variable name").optional(),
  })
  .refine((field) => !field.secret || field.env !== undefined, {
    message: "manifest.config.env is required when secret is true",
    path: ["env"],
  })
  .refine((field) => field.default === undefined || field.enum === undefined || field.enum.includes(field.default), {
    message: "manifest.config.default must be one of the enum values",
    path: ["default"],
  });

export const ManifestSchema = z.strictObject({
  manifest_version: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "manifest.id must use lowercase letters, digits, or hyphens"),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "manifest.version must use major.minor.patch"),
  platform: z.string().min(1),
  entry: EntrySchema,
  config: z.record(z.string(), ConfigFieldSchema).optional(),
  target: z.string().min(1).optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage_url: z.url("manifest.homepage_url must be a valid URL").optional(),
  icons: z.array(z.string()).optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export function parseManifest(text: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const version =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).manifest_version
      : undefined;
  if (version !== undefined && version !== 1) {
    throw new Error(`Unsupported manifest_version: ${JSON.stringify(version)}`);
  }

  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    });
    throw new Error(`Invalid manifest: ${issues.join("; ")}`);
  }
  return result.data;
}

export function resolveEntry(manifest: Manifest, mode: "package" | "directory"): readonly string[] {
  const key = mode === "package" ? "production" : "development";
  const entry = manifest.entry[key];
  if (!entry) throw new Error(`manifest.entry.${key} is required`);
  return entry;
}
