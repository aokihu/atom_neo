import { describe, expect, test } from "bun:test";
import { BusEvents, IntentRequestType } from "@atom-neo/shared";
import { makeBus } from "../../test-helpers";
import { CheckFollowUpElement } from "./check-follow-up";

function createElement(todoState: any[] = []) {
  return new CheckFollowUpElement({
    name: "check-follow-up",
    kind: "boundary",
    bus: makeBus(),
    session: { todoState },
  });
}

describe("CheckFollowUpElement", () => {
  test("starts an existing pending plan when no current content was generated", async () => {
    const todos = [
      { content: "chapter 1", status: "completed", priority: "high" },
      { content: "chapter 2", status: "pending", priority: "high" },
      { content: "chapter 3", status: "pending", priority: "high" },
    ];
    const element = createElement(todos);

    const result = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [],
      todoBefore: todos,
    });

    expect(result.chainAction).toBe("continue_todo");
  });

  test("allows completion after every TODO is terminal", async () => {
    const element = createElement([
      { content: "chapter 1", status: "completed", priority: "high" },
      { content: "chapter 2", status: "cancelled", priority: "low" },
    ]);

    const result = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [],
    });

    expect(result.chainAction).toBeUndefined();
  });

  test("preserves explicit and stream-level follow-up decisions", async () => {
    const element = createElement();
    const explicit = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [{ request: IntentRequestType.FOLLOW_UP, params: { summary: "next" } }],
    });
    const stream = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [],
      finishReason: "length",
    });

    expect(explicit.chainAction).toBe("follow_up");
    expect(stream.chainAction).toBe("follow_up");
  });

  test("keeps stream follow-up ahead of active TODO continuation", async () => {
    const element = createElement([
      { content: "chapter 2", status: "in_progress", priority: "high" },
    ]);

    const result = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [],
      finishReason: "length",
    });

    expect(result.chainAction).toBe("follow_up");
  });

  test("does not loop active TODOs after a non-recoverable request error", async () => {
    const element = createElement([
      { content: "chapter 2", status: "in_progress", priority: "high" },
    ]);

    const result = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [],
      errorStatusCode: 400,
    });

    expect(result.chainAction).toBeUndefined();
  });

  test("does not preserve explicit follow-up after a non-recoverable request error", async () => {
    const element = createElement();

    const result = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [{ request: IntentRequestType.FOLLOW_UP, params: { summary: "next" } }],
      errorStatusCode: 400,
    });

    expect(result.chainAction).toBeUndefined();
  });
});

const first = { content: "输出第1-3段", status: "in_progress", priority: "high" } as const;
const second = { content: "输出第4-6段", status: "pending", priority: "high" } as const;
const target = { index: 0, content: first.content };
const explicitIntent = [{ request: IntentRequestType.FOLLOW_UP, params: { next_prompt: "继续第4-6段", summary: "1-3完成", avoid_repeat: "起源" } }];
const model = { type: "jev" as const, apiKey: "test", model: "test-model", baseUrl: "https://decisions.example.test" };
function arbitration(todos: any[], options: any = {}) {
  const session = { todoState: todos, messages: [{ role: "user", content: "写世界文明史" }] };
  return new CheckFollowUpElement({ name: "check-follow-up", kind: "boundary", bus: makeBus(), session, ...options });
}
function flow(options: any = {}): any {
  return { mode: "executing", task: { id: "task", sessionId: "session" }, todoBefore: [first, second],
    currentTodo: target, finishReason: "stop", responseText: "已经输出到第十段", intents: [], ...options };
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

describe("Continuation arbitration", () => {
  test("logs the actual bounded decision request and correlates it with the final runtime choice", async () => {
    const bus = makeBus(); const events: any[] = []; let sent: any;
    bus.on(BusEvents.Element.Data, ({ payload }) => events.push(payload));
    const element = arbitration([first, second], { bus, decisionModel: model, fetchImpl: async (_url: any, init: any) => {
      sent = JSON.parse(init.body); return response(sent.questions, "finish");
    } });
    const result = await element.doProcess(flow({ task: { id: "executing", parentTaskId: "prediction", chainId: "root", sessionId: "session" },
      contextSnapshot: { id: "snapshot" }, responseText: "正文".repeat(2000) }));
    const requests = events.filter(event => event.step === "decision-request");
    expect(requests).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(requests[0].state))).toEqual(sent.state);
    expect(requests[0].questions).toEqual(sent.questions);
    expect(requests[0]).toMatchObject({ taskId: "executing", parentTaskId: "prediction", rootTaskId: "root", snapshotId: "snapshot", source: "jev" });
    expect(requests[0].state.response.truncated).toBe(true);
    expect(requests[0]).not.toHaveProperty("apiKey");
    expect(events.find(event => event.step === "arbitrated")).toMatchObject({ taskId: "executing", choice: "finish" });
    expect(events.find(event => event.step === "done")).toMatchObject({ taskId: "executing", kind: result.continuationDecision?.kind, reason: "invalid_progress_transition" });
    expect(result.chainAction).toBe("reconcile_todo");
  });
  test("length wins over completion claims without a decision model call", async () => {
    let calls = 0;
    const bus = makeBus(); const events: any[] = [];
    bus.on(BusEvents.Element.Data, ({ payload }) => events.push(payload));
    const result = await arbitration([first, second], { bus, simulate: async () => { calls++; return {}; } }).doProcess(flow({ finishReason: "length", completeDetected: true }));
    expect(result.continuationDecision).toMatchObject({ kind: "resume_current", target, source: "rules" });
    expect(calls).toBe(0);
    expect(events.some(event => event.step === "decision-request")).toBe(false);
  });
  test("recorded TODO handoff advances without JEV", async () => {
    const result = await arbitration([{ ...first, status: "completed" }, { ...second, status: "in_progress" }]).doProcess(flow());
    expect(result.continuationDecision).toMatchObject({ kind: "advance_todo", target: { index: 1, content: second.content } });
  });
  test("context overflow preserves approved continuation parameters for compression", async () => {
    const request = { kind: "resume_current", source: "jev", reason: "current_remainder", target,
      followUp: { summary: "前半已写", nextPrompt: "只写后半", avoidRepeat: "前半" } };
    const result = await arbitration([first, second]).doProcess(flow({ tokenOverflow: true,
      task: { id: "overflow", sessionId: "session", payload: [{ type: "continuation_request", data: request }] } }));
    expect(result.continuationDecision).toMatchObject({ kind: "resume_current", reason: "context_overflow", target, followUp: request.followUp });
  });
  test.each(["finish", "advance_todo"])("rejects semantic %s against stale TODO progress", async choice => {
    let calls = 0;
    const element = arbitration([first, second], { decisionModel: model, fetchImpl: async (_url: any, init: any) => {
      calls++; const sent = JSON.parse(init.body); expect(sent.state.todoBefore).toHaveLength(2);
      expect(sent.state.intent.nextPrompt).toBe("继续第4-6段");
      return response(sent.questions, choice);
    } });
    const result = await element.doProcess(flow({ completeDetected: true, intents: explicitIntent }));
    expect(calls).toBe(1);
    expect(result.continuationDecision).toMatchObject({ kind: "reconcile_progress", source: "jev", reason: "invalid_progress_transition" });
    expect(result.chainAction).toBe("reconcile_todo");
  });
  test("accepts same-item continuation and preserves all parameters", async () => {
    const result = await arbitration([first, second], { decisionModel: model, fetchImpl: async (_url: any, init: any) => response(JSON.parse(init.body).questions, "resume_current") })
      .doProcess(flow({ intents: explicitIntent }));
    expect(result.continuationDecision).toMatchObject({ kind: "resume_current", target,
      followUp: { summary: "1-3完成", nextPrompt: "继续第4-6段", avoidRepeat: "起源" } });
  });
  test.each(["other", "unknown"])("intentScope %s cannot authorize same-item resume", async scope => {
    const result = await arbitration([first, second], { decisionModel: { type: "llm", apiKey: "test", model: "test" },
      simulate: async (_state: any, questions: any) => ({ ...simulationAnswers(questions, "resume_current"), intentScope: scope }) })
      .doProcess(flow({ intents: explicitIntent }));
    expect(result.continuationDecision?.kind).toBe("reconcile_progress");
  });
  test("reason labels cannot override the dedicated content and scope decisions", async () => {
    const result = await arbitration([first, second], { decisionModel: { type: "llm", apiKey: "test", model: "test" },
      simulate: async (_state: any, questions: any) => ({ ...simulationAnswers(questions, "resume_current"), reasonCode: "scope_conflict" }) })
      .doProcess(flow({ intents: explicitIntent }));
    expect(result.continuationDecision?.kind).toBe("resume_current");
  });
  test("marks clipped response evidence and accepts LLM simulation", async () => {
    let state: any;
    const result = await arbitration([first, second], { decisionModel: { type: "llm", apiKey: "test", model: "test" },
      simulate: async (input: any, questions: any) => { state = input; return simulationAnswers(questions, "resume_current"); } })
      .doProcess(flow({ responseText: "前".repeat(6000) + "末尾" }));
    expect(state.response.truncated).toBe(true);
    expect(state.response.text).toContain("末尾");
    expect(result.continuationDecision?.source).toBe("llm");
  });
  test.each(["rules", "missing", "illegal", "timeout"])("falls back to bounded reconciliation on %s", async scenario => {
    const result = await arbitration([first, second], { decisionMode: scenario === "rules" ? "rules" : "jev",
      decisionModel: scenario === "missing" ? undefined : model, timeoutMs: 5,
      fetchImpl: async (_url: any, init: any) => scenario === "timeout" ? new Promise(() => {}) : response(JSON.parse(init.body).questions, "illegal") })
      .doProcess(flow({ completeDetected: true }));
    expect(result.chainAction).toBe("reconcile_todo");
  });
  test("caller cancellation during arbitration prevents any continuation", async () => {
    const controller = new AbortController();
    const promise = arbitration([first, second], { decisionModel: model,
      fetchImpl: async () => new Promise(() => {}) }).doProcess(flow({ abortSignal: controller.signal }));
    controller.abort();
    const result = await promise;
    expect(result.chainAction).toBeUndefined();
    expect(result.suppressPostCheck).toBe(true);
  });
  test("unknown/duplicate current identity cannot advance", async () => {
    const result = await arbitration([{ ...first, content: "替换任务" }, second], { decisionMode: "rules" }).doProcess(flow());
    expect(result.chainAction).toBe("reconcile_todo");
  });
  test("a new pending-only plan with unidentified content requires reconciliation", async () => {
    const result = await arbitration([{ ...first, status: "pending" }, second], { decisionMode: "rules" })
      .doProcess(flow({ todoBefore: [], currentTodo: undefined, responseText: "已输出第一项的一部分" }));
    expect(result.chainAction).toBe("reconcile_todo");
  });
  test("successful reconciliation advances using real state only", async () => {
    const result = await arbitration([{ ...first, status: "completed" }, { ...second, status: "in_progress" }]).doProcess(flow({
      task: { id: "fix", sessionId: "session", payload: [{ type: "continuation_request", data: { kind: "reconcile_progress", target } }] },
    }));
    expect(result.continuationDecision?.kind).toBe("advance_todo");
  });
  test("unchanged reconciliation stops instead of default success or retry", async () => {
    const result = await arbitration([first, second]).doProcess(flow({ task: { id: "fix", sessionId: "session",
      payload: [{ type: "continuation_request", data: { kind: "reconcile_progress", target } }] } }));
    expect(result.chainAction).toBeUndefined();
    expect(result.suppressPostCheck).toBe(true);
    expect(result.responseText).toContain("尚未确认");
  });
  test.each([{ toolStopReason: "max_executions" }, { cancelled: true }, { errorStatusCode: 400 }])("runtime stop overrides active todos and intents: %j", async flags => {
    const result = await arbitration([first, second]).doProcess(flow({ ...flags, intents: explicitIntent }));
    expect(result.chainAction).toBeUndefined();
    expect(result.suppressPostCheck).toBe(true);
  });
});

test("arbitration receives the executed request and refuses repeated text without progress", async () => {
  const text = "文明已经从农业社会走向城市社会。".repeat(10);
  const request = { kind: "resume_current", source: "jev", reason: "segment", target,
    followUp: { summary: "前半", nextPrompt: "写剩余部分", avoidRepeat: "前半" } };
  const session = { todoState: [first, second], messages: [{ role: "user", content: "文明史" }, { role: "assistant", content: text }] };
  let sent: any;
  const element = new CheckFollowUpElement({ name: "check-follow-up", kind: "boundary", bus: makeBus(), session,
    decisionModel: model, fetchImpl: async (_url, init) => { sent = JSON.parse(String(init.body)); return response(sent.questions, "resume_current"); } });
  const result = await element.doProcess(flow({ responseText: text, task: { id: "task", sessionId: "session",
    payload: [{ type: "continuation_request", data: request }] } }));
  expect(sent.state.incomingContinuation).toEqual(request);
  expect(sent.state.repeatedOutput).toBe(true);
  expect(result.continuationDecision?.kind).toBe("reconcile_progress");
});
