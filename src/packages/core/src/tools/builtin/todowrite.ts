import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";

export const TodoItemSchema = z.object({
  content: z.string().describe("任务描述"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).describe("任务状态"),
  priority: z.enum(["high", "medium", "low"]).describe("优先级"),
});

export type TodoItemInput = z.infer<typeof TodoItemSchema>;

export const TodoWriteInputSchema = z.object({
  todos: z.array(TodoItemSchema).describe("完整的任务列表，每次调用传入全量替换当前进度"),
});

export type TodoWriteInput = z.infer<typeof TodoWriteInputSchema>;

function formatProgress(todos: TodoWriteInput["todos"]): string {
  if (todos.length === 0) return "任务列表已清空。";
  const icons: Record<string, string> = { pending: "⬜", in_progress: "🔄", completed: "✅", cancelled: "❌" };
  const lines = todos.map((t, i) => {
    const icon = icons[t.status] ?? "⬜";
    return `${icon} [${t.priority}] ${i + 1}. ${t.content}`;
  });
  const next = todos.find(t => t.status === "pending");
  const hint = next ? `\n下一步: ${next.content}` : "";
  return `任务进度:\n${lines.join("\n")}${hint}`;
}

export function createTodoWriteTool(): ToolDefinition {
  return {
    name: "todowrite",
    description:
      "维护当前会话的任务进度列表。每次调用传入完整的 todos 数组，将全量替换之前的进度。每个任务包含 content(描述)、status(pending|in_progress|completed|cancelled)、priority(high|medium|low)。使用此工具来规划和跟踪复杂任务的执行进度。",
    source: "builtin",
    inputSchema: TodoWriteInputSchema,
    execute: async (args) => {
      const todos = (args as TodoWriteInput).todos;
      return { ok: true, output: formatProgress(todos) };
    },
    permission: PermissionLevel.READ_ONLY,
  };
}
