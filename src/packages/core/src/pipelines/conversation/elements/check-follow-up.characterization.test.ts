/**
 * Behavior snapshot for CheckFollowUpElement (S12-E1).
 *
 * Locks: rules order, continuationDecision fields, chainAction,
 * suppressPostCheck/responseText, and Element.Data/Transport.Delta step order.
 * Time, task ids and prompt text are intentionally not snapshotted.
 */
import { describe, expect, test } from "bun:test";
import { BusEvents, IntentRequestType } from "@atom-neo/shared";
import type { ConversationContinuationAction } from "@atom-neo/shared";
import { makeBus, makePromptResolver } from "@core/pipelines/test-helpers";
import { CheckFollowUpElement } from "./check-follow-up";

const first = { content: "输出第1-3段", status: "in_progress", priority: "high" } as const;
const second = { content: "输出第4-6段", status: "pending", priority: "high" } as const;
const target = { index: 0, content: first.content };
const activeTodos = [first, second];
const completedCurrent = [{ ...first, status: "completed" }, second] as const;
const allDone = [{ ...first, status: "completed" }, { ...second, status: "completed" }] as const;
const explicitIntent = [{ request: IntentRequestType.FOLLOW_UP, params: { next_prompt: "继续第4-6段", summary: "1-3完成", avoid_repeat: "起源" } }];
const followUp = { summary: "1-3完成", nextPrompt: "继续第4-6段", avoidRepeat: "起源" };
const reconcileTask = (targetValue = target) => ({ id: "fix", sessionId: "session",
  payload: [{ type: "continuation_request", data: { kind: "reconcile_progress", target: targetValue } }] });
const model = { type: "jev" as const, apiKey: "test", model: "test-model", baseUrl: "https://decisions.example.test" };

function harness(todos: readonly any[] = activeTodos, options: any = {}) {
  const bus = makeBus();
  const events: any[] = [];
  const deltas: string[] = [];
  bus.on(BusEvents.Element.Data, ({ payload }: any) => events.push(payload));
  bus.on(BusEvents.Transport.Delta, ({ payload }: any) => deltas.push(payload.textDelta));
  const element = new CheckFollowUpElement({ name: "check-follow-up", kind: "boundary", bus, promptResolver: makePromptResolver(),
    session: { todoState: todos, messages: [{ role: "user", content: "写世界文明史" }] } as any, ...options });
  return { element, events, deltas };
}

function flow(options: any = {}): any {
  return { mode: "executing", task: { id: "executing", parentTaskId: "prediction", chainId: "root", sessionId: "session" },
    todoBefore: activeTodos, currentTodo: target, finishReason: "stop", responseText: "已经输出到第十段", intents: [], ...options };
}

function response(questions: any, choice: string) {
  const answers = simulationAnswers(questions, choice);
  return Response.json({ model: "test-model", answers: Object.fromEntries(Object.entries(questions).map(([id, question]: any) => [id, {
    type: "choice", choice: answers[id], confidence: 0.9,
    probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === answers[id] ? 1 : 0])),
  }])) });
}

function simulationAnswers(questions: any, choice: string): Record<string, string> {
  const selected: Record<string, string> = { continuation: choice, contentState: choice === "resume_current" ? "unfinished" : "unknown",
    intentScope: "current", reasonCode: "content_gap", evidenceRef: "current" };
  return Object.fromEntries(Object.entries(questions).map(([id, question]: any) => [id, selected[id] ?? (id.startsWith("requirement_") ? "unknown" : Object.keys(question.criteria)[0])]));
}

type RuleCase = {
  name: string;
  todos?: readonly any[];
  input?: any;
  expected: Record<string, unknown>;
  chainAction?: ConversationContinuationAction;
  suppress?: boolean;
  responseText?: string;
  delta?: boolean;
  reconciliation?: boolean;
  options?: any;
};

const RULE_CASES: RuleCase[] = [
  { name: "runtime cancelled", input: { cancelled: true },
    expected: { kind: "finish", reason: "runtime_stopped", source: "rules", target }, suppress: true },
  { name: "runtime aborted", input: { abortSignal: AbortSignal.abort() },
    expected: { kind: "finish", reason: "runtime_stopped", source: "rules", target }, suppress: true },
  { name: "runtime non-recoverable status", input: { errorStatusCode: 400 },
    expected: { kind: "finish", reason: "runtime_stopped", source: "rules", target }, suppress: true },
  { name: "runtime tool governance stop", input: { toolStopReason: "max_executions" },
    expected: { kind: "finish", reason: "runtime_stopped", source: "rules", target }, suppress: true },
  { name: "token overflow resumes the approved request", input: { tokenOverflow: true, intents: explicitIntent,
      task: { id: "overflow", sessionId: "session", payload: [{ type: "continuation_request", data: { kind: "resume_current",
        source: "jev", reason: "segment", target } }] } },
  expected: { kind: "resume_current", reason: "context_overflow", source: "rules", target, followUp }, chainAction: "follow_up" },
  { name: "unchanged reconciliation stops", input: { task: reconcileTask() },
    expected: { kind: "finish", reason: "reconciliation_failed", source: "rules" }, suppress: true,
    responseText: "任务进度尚未确认，已停止自动推进；未完成的 TODO 已保留。", delta: true, reconciliation: true },
  { name: "reconciliation without active todos finishes", todos: allDone, input: { task: reconcileTask() },
    expected: { kind: "finish", reason: "progress_reconciled", source: "rules" }, reconciliation: true },
  { name: "reconciliation advances a terminal current item", todos: completedCurrent,
    input: { task: reconcileTask(), todoBefore: activeTodos },
    expected: { kind: "advance_todo", reason: "progress_reconciled", source: "rules", target: { index: 1, content: second.content } },
    chainAction: "continue_todo", reconciliation: true },
  { name: "reconciliation confirms the current item", input: { task: reconcileTask(), todoBefore: [] },
    expected: { kind: "resume_current", reason: "current_task_confirmed", source: "rules", target }, chainAction: "follow_up",
    reconciliation: true },
  { name: "reconciliation with lost current identity stops",
    todos: [{ ...first, content: "替换任务" }, second], input: { task: reconcileTask() },
    expected: { kind: "finish", reason: "reconciliation_failed", source: "rules" }, suppress: true,
    responseText: "任务进度尚未确认，已停止自动推进；未完成的 TODO 已保留。", delta: true, reconciliation: true },
  { name: "length interruption resumes", input: { finishReason: "length" },
    expected: { kind: "resume_current", reason: "output_interrupted", source: "rules", target }, chainAction: "follow_up" },
  { name: "stream interruption resumes", input: { streamInterrupted: true },
    expected: { kind: "resume_current", reason: "output_interrupted", source: "rules", target }, chainAction: "follow_up" },
  { name: "finish reason error resumes", input: { finishReason: "error" },
    expected: { kind: "resume_current", reason: "output_interrupted", source: "rules", target }, chainAction: "follow_up" },
  { name: "recorded handoff advances", todos: completedCurrent, input: { todoBefore: activeTodos },
    expected: { kind: "advance_todo", reason: "todo_handoff", source: "rules", target: { index: 1, content: second.content } },
    chainAction: "continue_todo" },
  { name: "no active work finishes", todos: allDone, input: { todoBefore: allDone, currentTodo: undefined },
    expected: { kind: "finish", reason: "output_finished", source: "rules" } },
  { name: "explicit follow-up without todos resumes", todos: [], input: { todoBefore: [], currentTodo: undefined, intents: explicitIntent },
    expected: { kind: "resume_current", reason: "explicit_follow_up", source: "rules", followUp }, chainAction: "follow_up" },
  { name: "pending plan starts without new text", input: { currentTodo: undefined, responseText: "" },
    expected: { kind: "advance_todo", reason: "pending_plan", source: "rules", target: { index: 0, content: first.content } },
    chainAction: "continue_todo" },
  { name: "rules mode reconciles ambiguous progress", input: { intents: explicitIntent }, expected: { kind: "reconcile_progress",
      reason: "ambiguous_progress", source: "rules", target, followUp }, chainAction: "reconcile_todo",
    options: { decisionMode: "rules" } },
];

describe("check-follow-up behavior snapshot", () => {
  test.each(RULE_CASES.map(entry => [entry.name, entry] as const))("rules: %s", async (_name, entry) => {
    const { element, events, deltas } = harness(entry.todos, entry.options);
    const result = await element.doProcess(flow(entry.input));
    expect(result.continuationDecision).toMatchObject(entry.expected);
    expect(result.chainAction).toBe(entry.chainAction);
    expect(result.suppressPostCheck).toBe(entry.suppress);
    if (entry.responseText) expect(result.responseText).toBe(entry.responseText);
    expect(deltas).toHaveLength(entry.delta ? 1 : 0);
    expect(events.map(event => event.step)).toEqual([
      ...(entry.reconciliation ? ["reconciliation-result"] : []),
      "done",
    ]);
    expect(events.at(-1)).toMatchObject({ step: "done", chainAction: entry.chainAction ?? "none",
      kind: entry.expected.kind, reason: entry.expected.reason, source: entry.expected.source });
    expect(events.some(event => event.step === "decision-request")).toBe(false);
  });

  test("snapshot: runtime stop stays ahead of token overflow and follow-up intents", async () => {
    const { element, events } = harness(activeTodos);
    const result = await element.doProcess(flow({ cancelled: true, tokenOverflow: true, intents: explicitIntent,
      finishReason: "length" }));
    expect(result.continuationDecision).toMatchObject({ kind: "finish", reason: "runtime_stopped", source: "rules", followUp });
    expect(result.suppressPostCheck).toBe(true);
    expect(events.map(event => event.step)).toEqual(["done"]);
  });

  test("snapshot: reconciliation-result carries before/after and target matching", async () => {
    const { element, events } = harness(activeTodos);
    await element.doProcess(flow({ task: reconcileTask() }));
    expect(events[0]).toMatchObject({
      step: "reconciliation-result",
      incomingContinuation: { kind: "reconcile_progress", target },
      todoBefore: activeTodos,
      todoAfter: activeTodos,
      currentTodo: target,
      targetBefore: { index: 0, todo: first },
      targetAfter: { index: 0, todo: first },
      progressChanged: false,
      targetMatched: true,
      chainAction: "none",
      continuationDecision: { kind: "finish", reason: "reconciliation_failed", source: "rules" },
    });
  });

  test("snapshot: done reports candidates derived from the session", async () => {
    const { element, events } = harness(allDone);
    await element.doProcess(flow({ todoBefore: allDone, currentTodo: undefined, intents: explicitIntent }));
    expect(events.at(-1)).toMatchObject({ step: "done", candidates: {
      finishReason: "stop", intent: true, activeTodos: false } });
  });

  test.each(["finish", "advance_todo"])("snapshot: LLM %s is rejected against stale progress", async choice => {
    const { element, events } = harness(activeTodos, { decisionModel: model,
      fetchImpl: async (_url: any, init: any) => response(JSON.parse(init.body).questions, choice) });
    const result = await element.doProcess(flow({ completeDetected: true, intents: explicitIntent }));
    expect(result.continuationDecision).toMatchObject({ kind: "reconcile_progress", reason: "invalid_progress_transition", source: "jev" });
    expect(result.chainAction).toBe("reconcile_todo");
    expect(events.map(event => event.step)).toEqual(["decision-request", "arbitrated", "done"]);
    expect(events[0]).toMatchObject({ purpose: "continuation", source: "jev", taskId: "executing",
      parentTaskId: "prediction", rootTaskId: "root" });
    expect(events[1]).toMatchObject({ source: "jev", choice, assessment: { contentState: "unknown", intentScope: "current" } });
  });

  test("snapshot: LLM same-item resume preserves the approved follow-up", async () => {
    const { element, events } = harness(activeTodos, { decisionModel: model,
      fetchImpl: async (_url: any, init: any) => response(JSON.parse(init.body).questions, "resume_current") });
    const result = await element.doProcess(flow({ intents: explicitIntent }));
    expect(result.continuationDecision).toEqual({ kind: "resume_current", reason: "semantic_arbitration", source: "jev", target, followUp });
    expect(events.map(event => event.step)).toEqual(["decision-request", "arbitrated", "done"]);
  });

  test("snapshot: timeout falls back to bounded reconciliation", async () => {
    const { element, events } = harness(activeTodos, { decisionMode: "jev", decisionModel: model, timeoutMs: 5,
      fetchImpl: async () => new Promise(() => {}) });
    const result = await element.doProcess(flow({ completeDetected: true }));
    expect(result.continuationDecision).toMatchObject({ kind: "reconcile_progress", reason: "decision_unavailable", source: "fallback" });
    expect(result.chainAction).toBe("reconcile_todo");
    expect(events.map(event => event.step)).toEqual(["decision-request", "arbitration-failed", "done"]);
    expect(events[1]?.error).toBeString();
  });

  test("snapshot: cancellation during arbitration suppresses any continuation", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => { started = resolve; });
    const { element, events } = harness(activeTodos, { decisionModel: model,
      fetchImpl: async () => { started(); return new Promise(() => {}); } });
    const pending = element.doProcess(flow({ abortSignal: controller.signal }));
    await startedPromise;
    controller.abort();
    const result = await pending;
    expect(result.continuationDecision).toMatchObject({ kind: "finish", reason: "cancelled", source: "rules" });
    expect(result.chainAction).toBeUndefined();
    expect(result.suppressPostCheck).toBe(true);
    expect(events.map(event => event.step)).toEqual(["decision-request", "arbitration-failed", "done"]);
  });

  test("snapshot: beforeCall cancellation never calls the decision model", async () => {
    const controller = new AbortController();
    let calls = 0;
    const { element, events } = harness(activeTodos, { decisionModel: { ...model, beforeCall: async (signal?: AbortSignal) => {
      controller.abort(); signal?.throwIfAborted();
    } }, fetchImpl: async () => { calls++; return response({}, "finish"); } });
    const result = await element.doProcess(flow({ abortSignal: controller.signal }));
    expect(result.continuationDecision).toMatchObject({ kind: "finish", reason: "runtime_stopped", source: "rules" });
    expect(result.suppressPostCheck).toBe(true);
    expect(calls).toBe(0);
    expect(events.map(event => event.step)).toEqual(["done"]);
  });

  test("snapshot: non-executing input passes through untouched", async () => {
    const { element, events } = harness(); const input = flow({ mode: "ready_to_finalize" });
    expect(await element.doProcess(input)).toBe(input);
    expect(events).toHaveLength(0);
  });
});
