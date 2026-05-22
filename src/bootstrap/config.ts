import { z } from "zod";
import { readFileSync } from "node:fs";

const ConfigSchema = z.object({
  transport: z.object({
    maxOutputTokens: z.number().int().default(4096),
  }).default({ maxOutputTokens: 4096 }),
  gateway: z.object({
    jwtSecret: z.string().default("change-me-minimum-16-chars"),
    port: z.number().int().default(3000),
  }).default({ jwtSecret: "change-me-minimum-16-chars", port: 3000 }),
  tui: z.object({
    theme: z.enum(["dark", "light"]).default("dark"),
  }).default({ theme: "dark" }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(sandboxPath: string): AppConfig {
  const configPath = `${sandboxPath}/config.json`;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return ConfigSchema.parse(raw);
  } catch {
    return ConfigSchema.parse({});
  }
}
