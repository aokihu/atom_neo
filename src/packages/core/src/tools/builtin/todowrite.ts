import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";

export const TodoItemSchema = z.object({
  content: z.string().describe("Task description"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).describe("Task status"),
  priority: z.enum(["high", "medium", "low"]).describe("Priority"),
});

export type TodoItemInput = z.infer<typeof TodoItemSchema>;

export const TodoWriteInputSchema = z.object({
  todos: z.array(TodoItemSchema).describe("Full task list to replace current state"),
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
      "Manage task progress list. Pass full todos array to replace previous state. Each todo: content, status(pending|in_progress|completed|cancelled), priority(high|medium|low).",
    source: "builtin",
    inputSchema: TodoWriteInputSchema,
    execute: async (args) => {
      const todos = (args as TodoWriteInput).todos;
      const inProgressCount = todos.filter(t => t.status === "in_progress").length;
      if (inProgressCount > 1) {
        const errMsg = `一次只能有一个任务处于进行中(in_progress)状态，当前有 ${inProgressCount} 个。请只保留一个 in_progress，其余置为 pending。`;
        return { ok: false, output: "", error: errMsg };
      }
      return { ok: true, output: formatProgress(todos) };
    },
    permission: PermissionLevel.READ_ONLY,
  };
}
