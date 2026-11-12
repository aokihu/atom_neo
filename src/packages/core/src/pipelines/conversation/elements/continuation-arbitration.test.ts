import { describe, expect, test } from "bun:test";
import { makePromptResolver } from "../../test-helpers";
import { arbitrateContinuation } from "./continuation-arbitration";
import type { ContinuationRouting } from "./continuation-rules";

const first = { content: "输出第1-3段", status: "in_progress", priority: "high" } as const;
const second = { content: "输出第4-6段", status: "pending", priority: "high" } as const;
const target = { index: 0, content: first.content };
const next = { index: 1, content: second.content };
const routing: ContinuationRouting = { todos: [first, second], active: true, current: target, terminal: false, next, target, follow: false };
const session = { messages: [{ role: "user", content: "写世界文明史", seq: 1 }, { role: "assistant", content: "正在输出", visible: true, seq: 2 }],
  todoState: [first, second] } as any;

function input(overrides: Record<string, unknown> = {}): any {
  return { mode: "executing", task: { id: "task", sessionId: "session" }, todoBefore: [first, second],
    currentTodo: target, finishReason: "stop", responseText: "正文", intents: [], ...overrides };
}

const answers = (continuation: string) => ({ continuation, contentState: continuation === "resume_current" ? "unfinished" : "complete",
  reasonCode: "content_gap", evidenceRef: "current", intentScope: "current" });

function run(options: Record<string, unknown> = {}) {
  const steps: string[] = [];
  const promise = arbitrateContinuation({ input: input(options.input as any), session, routing, trace: { taskId: "task" },
    report: payload => steps.push(String(payload.step)),
    params: { promptResolver: makePromptResolver(), decisionModel: { type: "llm", apiKey: "test", model: "test" },
      simulate: async (_state: any, _questions: any) => answers("resume_current"), ...options.params as any } });
  return { promise, steps };
}

describe("arbitrateContinuation", () => {
  test("accepts same-item continuation and reports request then result", async () => {
    const { promise, steps } = run();
    const outcome = await promise;
    expect(outcome.decision).toMatchObject({ kind: "resume_current", reason: "semantic_arbitration", source: "llm", target });
    expect(steps).toEqual(["decision-request", "arbitrated"]);
  });

  test("rejects finish against active progress", async () => {
    const { promise } = run({ params: { simulate: async () => answers("finish") } });
    const outcome = await promise;
    expect(outcome.decision).toMatchObject({ kind: "reconcile_progress", reason: "invalid_progress_transition", source: "llm" });
  });

  test("timeout falls back to bounded reconciliation", async () => {
    const { promise, steps } = run({ params: { timeoutMs: 5, simulate: async () => new Promise(() => {}) } });
    const outcome = await promise;
    expect(outcome.decision).toMatchObject({ kind: "reconcile_progress", reason: "decision_unavailable", source: "fallback" });
    expect(steps).toEqual(["decision-request", "arbitration-failed"]);
  });

  test("caller cancellation suppresses post-checks", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => { started = resolve; });
    const { promise, steps } = run({ input: { abortSignal: controller.signal },
      params: { simulate: async () => { started(); return new Promise(() => {}); } } });
    await startedPromise;
    controller.abort();
    const outcome = await promise;
    expect(outcome).toEqual({ decision: { kind: "finish", reason: "cancelled", source: "rules", target }, suppressPostCheck: true });
    expect(steps).toEqual(["decision-request", "arbitration-failed"]);
  });

  test("missing model falls back without a decision request", async () => {
    const { promise, steps } = run({ params: { decisionModel: undefined } });
    const outcome = await promise;
    expect(outcome.decision).toMatchObject({ kind: "reconcile_progress", reason: "decision_unavailable", source: "fallback" });
    expect(steps).toEqual(["arbitration-failed"]);
  });
});
