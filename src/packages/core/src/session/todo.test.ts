import { describe, expect, test } from "bun:test";
import * as context from "./context";
import * as todo from "./todo";
import type { TodoContinuationDecision, TodoItem, TokenUsage } from "./context";

const todoItem = (content: string, status: TodoItem["status"]): TodoItem => ({
  content,
  status,
  priority: "high",
});

describe("TODO helpers", () => {
  test("selectCurrentTodo returns the first in-progress TODO", () => {
    const items = [
      todoItem("done", "completed"),
      todoItem("current", "in_progress"),
      todoItem("later", "in_progress"),
    ];

    expect(todo.selectCurrentTodo(items)).toEqual({ index: 1, content: "current" });
  });

  test("selectCurrentTodo returns undefined when nothing is in progress", () => {
    expect(todo.selectCurrentTodo([todoItem("pending", "pending")])).toBeUndefined();
    expect(todo.selectCurrentTodo([])).toBeUndefined();
  });

  test("findTodoTarget matches a unique content target", () => {
    const items = [todoItem("first", "completed"), todoItem("second", "in_progress")];

    expect(todo.findTodoTarget(items, { index: 0, content: "second" })).toEqual({
      index: 1,
      todo: items[1],
    });
  });

  test("findTodoTarget ignores a missing target and ambiguous content", () => {
    expect(todo.findTodoTarget([todoItem("first", "pending")])).toBeUndefined();
    expect(todo.findTodoTarget([
      todoItem("duplicate", "pending"),
      todoItem("duplicate", "in_progress"),
    ], { index: 0, content: "duplicate" })).toBeUndefined();
  });

  test("hasActiveTodos treats pending and in-progress as active", () => {
    expect(todo.hasActiveTodos()).toBe(false);
    expect(todo.hasActiveTodos([])).toBe(false);
    expect(todo.hasActiveTodos([todoItem("done", "completed"), todoItem("cancelled", "cancelled")])).toBe(false);
    expect(todo.hasActiveTodos([todoItem("pending", "pending")])).toBe(true);
    expect(todo.hasActiveTodos([todoItem("current", "in_progress")])).toBe(true);
  });

  test("decideTodoContinuation follows active TODO and chain-depth precedence", () => {
    const cases: Array<[TodoItem[] | undefined, number, number, TodoContinuationDecision]> = [
      [undefined, 0, 5, "complete"],
      [[todoItem("done", "completed")], 0, 5, "complete"],
      [[todoItem("current", "in_progress")], 4, 5, "continue"],
      [[todoItem("current", "in_progress")], 5, 5, "limit_reached"],
      [[todoItem("pending", "pending")], 6, 5, "limit_reached"],
    ];

    for (const [items, depth, max, expected] of cases) {
      expect(todo.decideTodoContinuation(items, depth, max)).toBe(expected);
    }
  });
});

describe("session/context barrel re-exports", () => {
  test("keeps TODO helper identities identical to session/todo", () => {
    expect(context.selectCurrentTodo).toBe(todo.selectCurrentTodo);
    expect(context.findTodoTarget).toBe(todo.findTodoTarget);
    expect(context.hasActiveTodos).toBe(todo.hasActiveTodos);
    expect(context.decideTodoContinuation).toBe(todo.decideTodoContinuation);
  });

  test("keeps helper types importable from session/context", () => {
    const item: TodoItem = todoItem("current", "in_progress");
    const decision: TodoContinuationDecision = context.decideTodoContinuation([item], 0, 5);
    const usage: TokenUsage = { total: 0 };

    expect(item.content).toBe("current");
    expect(decision).toBe("continue");
    expect(usage.total).toBe(0);
  });
});
