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
      "向系统发出控制信号。参数 action 可选: follow_up(请求分段续写, 需 next_prompt+summary 或 history_abstract), keep_memory(保存记忆, 需 mem_id)。调用后系统将自动接管后续流程, 无需等待回复。",
    source: "builtin",
    inputSchema: IntentInputSchema,
    execute: async () => ({ ok: true, output: "信号已收到" }),
    permission: PermissionLevel.READ_ONLY,
    silent: true,
  };
}
