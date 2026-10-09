import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";
import { toolResult } from "../outcome";

export const IntentInputSchema = z.object({
  action: z.enum(["follow_up", "retain_memory"]),
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
      "Request follow_up for unfinished content within the current task; Runtime arbitrates against TODO progress. A valid follow_up ends this reply. retain_memory confirms an existing memory and does not end the reply.",
    source: "builtin",
    inputSchema: IntentInputSchema,
    execute: async () => toolResult.stateChanged("信号已收到"),
    permission: PermissionLevel.READ_ONLY,
    silent: true,
  };
}

/** Confirm an existing memory without controlling the conversation lifecycle. */
export function retainIntentMemory(memory: any, id: string): boolean {
  if (!memory || !id) return false;
  const fullId = memory.findFullId?.(id) ?? (memory.has?.(id) ? id : null);
  if (!fullId) return false;
  memory.retain(fullId);
  return true;
}
