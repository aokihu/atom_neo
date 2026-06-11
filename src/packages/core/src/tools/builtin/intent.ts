import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";

export const IntentInputSchema = z.object({
  action: z.enum(["follow_up", "keep_memory"]),
  mem_id: z.string().optional(),
  next_prompt: z.string().optional(),
  summary: z.string().optional(),
  history_abstract: z.string().optional(),
  avoid_repeat: z.string().optional(),
});

export type IntentToolInput = z.infer<typeof IntentInputSchema>;

export function createIntentTool(): ToolDefinition {
  return {
    name: "intent",
    description:
      "Signal system to follow_up (continue segmented output) or keep_memory (save to long-term memory).",
    source: "builtin",
    inputSchema: IntentInputSchema,
    execute: async () => ({ ok: true, output: "信号已收到" }),
    permission: PermissionLevel.READ_ONLY,
    silent: true,
  };
}
