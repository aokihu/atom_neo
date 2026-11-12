import type { TodoItem, TodoTarget } from "@atom-neo/shared";

export type { TodoItem };

export function selectCurrentTodo(todos: readonly TodoItem[]): TodoTarget | undefined {
  const index = todos.findIndex(todo => todo.status === "in_progress");
  return index < 0 ? undefined : { index, content: todos[index]!.content };
}

export function findTodoTarget(todos: readonly TodoItem[], target?: TodoTarget) {
  if (!target) return undefined;
  const matches = todos.map((todo, index) => ({ todo, index })).filter(item => item.todo.content === target.content);
  return matches.length === 1 ? matches[0] : undefined;
}

export function hasActiveTodos(todos?: readonly TodoItem[]): boolean {
  return todos?.some(todo => todo.status === "pending" || todo.status === "in_progress") ?? false;
}

export type TodoContinuationDecision = "continue" | "complete" | "limit_reached";

export const decideTodoContinuation = (
  todos: readonly TodoItem[] | undefined,
  chainDepth: number,
  maxChainDepth: number,
): TodoContinuationDecision => {
  if (!hasActiveTodos(todos)) return "complete";
  return chainDepth >= maxChainDepth ? "limit_reached" : "continue";
};
