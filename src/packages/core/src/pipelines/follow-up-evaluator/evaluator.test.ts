import { test, expect, beforeAll } from "bun:test";
import { initPromptRegistry, TaskSource } from "@atom-neo/shared";
import { EvaluatorAnalyzeElement } from "./elements/evaluator-analyze";
import { EvaluatorInputElement } from "./elements/evaluator-input";
import { EvaluateFinalizeElement } from "./elements/evaluate-finalize";
import { SessionContext } from "../../session/context";
import { startExecutionGoal, prepareBudgetRelease } from "../../session/execution-budget";
import { createTaskItem } from "../../task-factory";
import { TaskQueue } from "../../task-queue";
import { InternalTaskOrchestrator } from "../../task/internal-task-orchestrator";
import { makeBus } from "../test-helpers";
import { ToolRecordStore } from "../../tools/tool-record-store";

beforeAll(() => initPromptRegistry());
function setup() {
  const session = new SessionContext("s");
  session.addMessage({ role: "user", content: "earlier weather", timestamp: 0 });
  session.addMessage({ role: "assistant", content: "sunny", pipeline: "conversation", timestamp: 0 });
  session.addMessage({ role: "user", content: "world history", timestamp: 1 });
  startExecutionGoal(session, "goal", "world history", 100);
  const budget = session.executionBudget!;
  budget.globalUsed = 5; budget.localUsed = 5; budget.pause = "health_check"; budget.resuming = true;
  const pending = createTaskItem({ sessionId: "s", chatId: "c", chainId: "goal", source: TaskSource.INTERNAL,
    pipeline: "conversation", payload: [{ type: "text", data: "exact pending" }, { type: "continuation_request", data: {
      kind: "advance_todo", source: "rules", reason: "handoff", target: { index: 1, content: "classical" },
      followUp: { nextPrompt: "next", summary: "saved", avoidRepeat: "old" } } }] });
  budget.pendingTask = pending;
  session.addMessage({ role: "assistant", content: "chapter one ".repeat(500), pipeline: "conversation", timestamp: 2 });
  const task = createTaskItem({ sessionId: "s", chatId: "c", chainId: "goal", source: TaskSource.INTERNAL,
    pipeline: "follow-up-evaluator", payload: [{ type: "budget_check", data: { goalId: "goal", windowId: 0 } }] });
  const input: any = { mode: "analyzing", task, session, recentSummary: "window", evidence: { originalGoal: "world history" }, budgetCheck: { goalId: "goal", windowId: 0 } };
  return { session, budget, task, pending, input };
}
function analyzer(extra: any = {}) {
  return new EvaluatorAnalyzeElement({ name: "evaluator-analyze", kind: "transform", bus: makeBus(),
    apiKey: "", model: "local", decisionModel: { type: "jev", apiKey: "test", model: "jev", baseUrl: "https://example.invalid/jev" },
    fallbackModel: { apiKey: "test", model: "llm" }, ...extra });
}
function native(health: string) {
  return async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string);
    return Response.json({ model: "jev", answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]: any) => [id, {
      type: "choice", choice: health, confidence: 0.5,
      probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === health ? 1 : 0])),
    }])) });
  };
}

test("input isolates the goal/window, includes real failed tools, marks cropped evidence", async () => {
  const s = setup(); const tools = new ToolRecordStore();
  s.budget.releasedTaskIds = ["business"];
  const group = tools.beginGroup("s", "business");
  tools.append(group, { modelStep: 1, batchIndex: 0, toolCallId: "call", toolName: "webfetch", source: "builtin",
    startedAt: 1, durationMs: 1, input: "url", metadata: { ok: false, effect: "none", error: "529" } as any });
  tools.seal(group);
  const result = await new EvaluatorInputElement({ name: "input", kind: "source", bus: makeBus(), session: s.session, toolRecordStore: tools }).process(s.input);
  expect(result.evidence!.originalGoal).toBe("world history");
  expect(result.recentSummary).not.toContain("sunny");
  expect(result.recentSummary).not.toContain("earlier weather");
  expect((result.evidence!.tools as any[])[0]).toMatchObject({ tool: "webfetch", ok: false, error: "529" });
  expect((result.evidence!.progress as any).outputRefs[0].truncated).toBe(true);
});

for (const health of ["healthy", "looping", "stuck", "degrading", "unknown"]) {
  test(`native JEV legal result ${health}`, async () => {
    expect((await analyzer({ fetchImpl: native(health) }).process(setup().input)).evaluation?.health).toBe(health as any);
  });
}

for (const failure of ["503", "529", "invalid", "timeout"]) {
  test(`JEV ${failure} performs exactly one LLM fallback`, async () => {
    let nativeCalls = 0, llmCalls = 0;
    const el = analyzer({ timeoutMs: 15, fetchImpl: async () => {
      nativeCalls++;
      if (failure === "timeout") return new Promise(() => {});
      if (failure === "invalid") return Response.json({ answers: {} });
      return new Response("unavailable", { status: Number(failure) });
    }, simulate: async () => { llmCalls++; return { health: "healthy" }; } });
    expect((await el.process(setup().input)).evaluation?.health).toBe("healthy");
    expect(nativeCalls).toBe(1); expect(llmCalls).toBe(1);
  });
}

test("no native JEV directly simulates once; missing credentials and double failure remain unknown", async () => {
  let calls = 0;
  const input = setup().input;
  expect((await analyzer({ decisionModel: { type: "jev", apiKey: "", model: "jev" }, simulate: async () => { calls++; return { health: "healthy" }; } }).process(input)).evaluation?.health).toBe("healthy");
  expect(calls).toBe(1);
  expect((await analyzer({ decisionModel: { apiKey: "", model: "" }, fallbackModel: { apiKey: "", model: "" } }).process(input)).evaluation?.health).toBe("unknown");
  expect((await analyzer({ fetchImpl: async () => new Response("", { status: 503 }), simulate: async () => { throw new Error("LLM failed"); } }).process(input)).evaluation?.health).toBe("unknown");
});

test("cancellation during native call prevents fallback", async () => {
  const controller = new AbortController(); let fallback = 0;
  const el = analyzer({ fetchImpl: async (_url: string, init: RequestInit) => {
    controller.abort(new Error("user cancelled")); throw init.signal?.reason;
  }, simulate: async () => { fallback++; return { health: "healthy" }; } });
  await expect(el.process({ ...setup().input, abortSignal: controller.signal })).rejects.toThrow("user cancelled");
  expect(fallback).toBe(0);
});

for (const health of ["healthy", "looping", "stuck", "degrading", "unknown"]) {
  test(`window finalize ${health} preserves global count and exact pending request`, async () => {
    const s = setup(); const queue = new TaskQueue(); const orchestrator = new InternalTaskOrchestrator(queue);
    orchestrator.beginTask(s.task);
    orchestrator.setReleaseGuard(task => prepareBudgetRelease({ session: s.session, task,
      limits: { maxGlobalRounds: 100, maxLocalRounds: 5 }, save: () => true, report() {}, notify() {} }));
    const el = new EvaluateFinalizeElement({ name: "finalize", kind: "sink", bus: makeBus(), orchestrator, contextService: {} as any });
    await el.process({ ...s.input, evaluation: { health, reason: "observed window", suggestion: "", upgradeModel: false } });
    expect(queue.size).toBe(0); // still staged until the parent checkpoint succeeds
    if (health === "healthy") {
      expect(s.budget).toMatchObject({ globalUsed: 5, localUsed: 0, windowId: 1 });
      expect(orchestrator.commitTask(s.task.id)).toBe(true);
      expect(queue.dequeue()).toEqual(s.pending);
      expect(s.budget).toMatchObject({ globalUsed: 6, localUsed: 1, globalAllowance: 100 });
    } else {
      expect(orchestrator.commitTask(s.task.id)).toBe(false);
      expect(s.budget).toMatchObject({ globalUsed: 5, localUsed: 5, pendingTask: s.pending, resuming: false });
      expect(s.session.messages.at(-1)?.content).toContain("任务尚未确认完成");
    }
  });
}

test("stale or cancelled judgment cannot reset a new window", async () => {
  const s = setup(); s.budget.windowId = 1;
  const el = new EvaluateFinalizeElement({ name: "finalize", kind: "sink", bus: makeBus(), orchestrator: {} as any, contextService: {} as any });
  await el.process({ ...s.input, evaluation: { health: "healthy" } });
  expect(s.budget.localUsed).toBe(5);
  s.budget.windowId = 0; s.budget.pause = "cancelled";
  await el.process({ ...s.input, evaluation: { health: "healthy" } });
  expect(s.budget.localUsed).toBe(5);
});

test("healthy window compression retains the complete pending task payload", async () => {
  const s = setup(); s.session.setContextTokens(950);
  let request: any;
  const el = new EvaluateFinalizeElement({ name: "finalize", kind: "sink", bus: makeBus(),
    orchestrator: { scheduleCompress(...args: any[]) { request = args[3]; } } as any,
    contextService: {} as any, configContextLimit: 1000, maxTokens: 100 });
  await el.process({ ...s.input, evaluation: { health: "healthy", reason: "progress", suggestion: "", upgradeModel: false } });
  expect(request).toMatchObject({ trigger: "context-pressure", resumeConversation: true, resumeTask: s.pending });
  expect(request.continuation).toEqual(s.pending.payload.find(part => part.type === "continuation_request")!.data);
  expect(s.budget).toMatchObject({ globalUsed: 5, localUsed: 0 });
});
