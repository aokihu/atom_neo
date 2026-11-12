import { describe, expect, test } from "bun:test";
import { IntentRequestType } from "@atom-neo/shared";
import type { ContinuationDecision } from "@atom-neo/shared";
import { buildContinuationDecision, evaluateContinuationRules } from "./continuation-rules";
import type { ContinuationRouting } from "./continuation-rules";

const first = { content: "输出第1-3段", status: "in_progress", priority: "high" } as const;
const second = { content: "输出第4-6段", status: "pending", priority: "high" } as const;
const target = { index: 0, content: first.content };
const next = { index: 1, content: second.content };
const followUp = { summary: "1-3完成", nextPrompt: "继续第4-6段", avoidRepeat: "起源" };

function routing(overrides: Partial<ContinuationRouting> = {}): ContinuationRouting {
  return { todos: [first, second], active: true, current: target, terminal: false, next, target, follow: false, ...overrides };
}

function input(overrides: Record<string, unknown> = {}): any {
  return { mode: "executing", task: {}, todoBefore: [first, second], currentTodo: target, finishReason: "stop",
    responseText: "正文", intents: [], ...overrides };
}

describe("evaluateContinuationRules", () => {
  test("runtime stop wins over overflow, interruption and follow-up intents", () => {
    const result = evaluateContinuationRules(input({ cancelled: true, tokenOverflow: true, finishReason: "length",
      intents: [{ request: IntentRequestType.FOLLOW_UP, params: {} }] }), routing({ follow: true, followUp }));
    expect(result).toMatchObject({ suppressPostCheck: true,
      decision: { kind: "finish", reason: "runtime_stopped", source: "rules", target, followUp } });
  });

  test("token overflow preserves the incoming request and approved follow-up", () => {
    const request: ContinuationDecision = { kind: "advance_todo", reason: "segment", source: "jev", target: next };
    const result = evaluateContinuationRules(input({ tokenOverflow: true }), routing({ request, followUp }));
    expect(result?.decision).toEqual({ kind: "resume_current", reason: "context_overflow", source: "rules", target, followUp });
  });

  test.each([
    ["unchanged", [first, second], { stopReconciliation: true, decision: { kind: "finish", reason: "reconciliation_failed", source: "rules" } }],
    ["inactive", [], { decision: { kind: "finish", reason: "progress_reconciled", source: "rules" } }],
    ["terminal", [first, second], { decision: { kind: "advance_todo", reason: "progress_reconciled", source: "rules", target: next } }],
    ["current", [first, second], { decision: { kind: "resume_current", reason: "current_task_confirmed", source: "rules", target } }],
  ] as const)("reconcile branch: %s", (scenario, todos, expected) => {
    const request = { kind: "reconcile_progress", reason: "x", source: "rules", target } as const;
    const overrides = scenario === "unchanged" ? {} : scenario === "inactive" ? { active: false, current: undefined }
      : scenario === "terminal" ? { terminal: true } : { current: target };
    const result = evaluateContinuationRules(input({ task: { payload: [{ type: "continuation_request", data: request }] },
      todoBefore: scenario === "unchanged" ? [first, second] : [first] }), routing({ request, todos, current: undefined, ...overrides }));
    expect(result).toMatchObject(expected);
  });

  test("lost current identity stops instead of advancing", () => {
    const request: ContinuationDecision = { kind: "reconcile_progress", reason: "x", source: "rules", target };
    const result = evaluateContinuationRules(input({ task: { payload: [{ type: "continuation_request", data: request }] } }),
      routing({ request, current: undefined, todos: [{ ...first, content: "替换任务" }, second] }));
    expect(result).toMatchObject({ stopReconciliation: true, decision: { kind: "finish", reason: "reconciliation_failed" } });
  });

  test.each([
    ["interrupt", { finishReason: "length" }, { kind: "resume_current", reason: "output_interrupted", target }],
    ["handoff", {}, { kind: "advance_todo", reason: "todo_handoff", target: next }],
    ["finish", {}, { kind: "finish", reason: "output_finished" }],
  ] as const)("routing branch: %s", (scenario, routeFlags, decision) => {
    const overrides = scenario === "handoff" ? { terminal: true } : scenario === "finish" ? { todos: [], active: false, current: undefined } : {};
    const flags = scenario === "finish" ? { currentTodo: undefined, todoBefore: [], responseText: "" } : routeFlags;
    const result = evaluateContinuationRules(input(flags), routing(overrides));
    expect(result?.decision).toMatchObject(decision);
  });

  test("rules mode and unresolved evidence return the documented fallbacks", () => {
    expect(evaluateContinuationRules(input(), routing({ decisionMode: "rules" }))?.decision)
      .toMatchObject({ kind: "reconcile_progress", reason: "ambiguous_progress", source: "rules", target });
    expect(evaluateContinuationRules(input(), routing())).toBeNull();
  });

  test("buildContinuationDecision uses next only for advance_todo", () => {
    expect(buildContinuationDecision("advance_todo", "x", "rules", { next, target, followUp }))
      .toEqual({ kind: "advance_todo", reason: "x", source: "rules", target: next, followUp });
    expect(buildContinuationDecision("resume_current", "x", "fallback", { next, target }))
      .toEqual({ kind: "resume_current", reason: "x", source: "fallback", target });
  });
});
