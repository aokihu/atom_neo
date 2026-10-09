import { expect, test } from "bun:test";
import { buildProgressEvidence, createProgressTrace } from "./progress-evidence";
import { buildAssistantReview } from "../post-conversation/elements/collect-input";

const target = { index: 0, content: "文明起源（约400字）" };
const todos = [{ content: target.content, status: "in_progress" as const, priority: "high" as const }];

test("completed TODO cannot hide the middle business chapter in a short review", () => {
  const parts = ["## 文明起源\n农业与文字", "文明起源的续写", "## 古典文明\n哲学与制度", "## 近代文明\n工业化与全球交流"]
    .map((content, index) => ({ seq: index + 3, content }));
  const result = buildAssistantReview(parts, todos.map(todo => ({ ...todo, status: "completed" })), "写四个阶段");
  expect(result.response).toContain("古典文明");
  expect(result.progressEvidence.outputRefs.map(part => part.ref)).toEqual(["3", "4", "5", "6"]);
  expect(result.progressEvidence.reviewCoverage.complete).toBe(true);
});

test("bounded evidence includes every provided part and reports actual cropping", () => {
  const result = buildProgressEvidence({ goal: "three chapters", todos: [], budget: 120,
    parts: ["origin", "classical", "modern"].map(name => ({ content: `${name}-${"长".repeat(300)}-${name}-end` })) });
  expect(result.outputRefs.map(part => part.text)).toEqual(expect.arrayContaining([
    expect.stringContaining("classical-end"), expect.stringContaining("modern-end"),
  ]));
  expect(result.reviewCoverage.complete).toBe(false);
  expect(result.outputRefs.every(part => part.truncated)).toBe(true);
});

test("output references preserve task association and mark discarded history", () => {
  const parts = Array.from({ length: 18 }, (_, index) => ({ seq: index + 1, content: "一段正文", metadata: { progress: { target } } }));
  const evidence = buildProgressEvidence({ goal: "write", todos, parts });
  expect(evidence.reviewCoverage).toMatchObject({ complete: false, providedParts: 16, omittedParts: 2 });
  expect(evidence.outputRefs[0]).toMatchObject({ ref: "3", target });
});

test("provider tool-calls is distinguished from actual TODO handoff", () => {
  const completed = todos.map(todo => ({ ...todo, status: "completed" as const }));
  const trace = createProgressTrace({ currentTodo: target, todoBefore: todos, todoHandoff: true, finishReason: "tool-calls" }, completed);
  expect(trace).toMatchObject({ before: "in_progress", after: "completed", terminalCause: "todo_handoff" });
});


test("unchanged progress check is not recorded as a TODO handoff", () => {
  expect(createProgressTrace({ currentTodo: target, todoBefore: todos, todoHandoff: true }, todos).terminalCause).toBe("progress_check");
});
