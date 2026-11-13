import { z } from "zod";

/** Gateway client entry shared by user config and gateway runtime config. */
export const ClientConfigSchema = z.object({
  id: z.string().min(1),
  platform: z.string().min(1),
  binary: z.string().min(1),
  clientArgs: z.record(z.string(), z.string()).optional(),
  stdio: z.enum(["inherit", "ignore"]).default("inherit"),
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;
