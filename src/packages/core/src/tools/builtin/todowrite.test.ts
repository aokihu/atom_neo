import { expect, test } from "bun:test";
import { createTodoWriteTool } from "./todowrite";

test("todowrite returns a Tool failure for incomplete arguments", async () => {
  const result = await createTodoWriteTool().execute({}, {});

  expect(result.metadata).toMatchObject({ ok: false });
  expect(result.metadata.error).toContain("complete todos array");
});

test("todowrite still accepts a complete task list", async () => {
  const result = await createTodoWriteTool().execute({ todos: [
    { content: "写第一段", status: "in_progress", priority: "high" },
  ] }, {});

  expect(result.metadata).toMatchObject({ ok: true, effect: "state_changed" });
  expect(result.content).toContain("写第一段");
});
