import { expect, test } from "bun:test";
import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import { ContextService } from "../../../context/context-service";
import { SessionContext } from "../../../session/context";
import { createIntentTool } from "../../../tools/builtin/intent";
import { createTodoWriteTool } from "../../../tools/builtin/todowrite";
import { makeBus } from "../../test-helpers";
import { StreamLLMElement } from "./stream-llm";
import { CheckFollowUpElement } from "./check-follow-up";

const one = { content: "文明起源", status: "in_progress", priority: "high" } as const;
const two = { content: "古典文明", status: "pending", priority: "high" } as const;
type Step = { text?: string; reasoning?: string; tool?: string; args?: unknown; finish?: string };
async function run(steps: Step[], options: { todos?: any[]; request?: any; memory?: any; beforeCall?: (signal?: AbortSignal) => Promise<void>; abortSignal?: AbortSignal } = {}) {
  const requests: any[] = [];
  const deltas: string[] = [];
  const events: any[] = [];
  const bus = makeBus();
  bus.on(BusEvents.Element.Data, ({ payload }) => events.push(payload));
  bus.on(BusEvents.Transport.Delta, ({ payload }) => deltas.push(payload.textDelta));
  const context = new ContextService(bus, { sweepIntervalMs: 0 }); context.start();
  const session = new SessionContext("boundary-session");
  session.setTodoState(options.todos ?? []);
  session.addMessage({ role: "user", content: "世界文明史", timestamp: Date.now(), visible: true });
  let dangerousCalls = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    requests.push(await request.json());
    const step = steps[requests.length - 1];
    if (!step) return Response.json({ error: { message: "unexpected extra generation" } }, { status: 400 });
    const delta = { role: "assistant", content: step.text ?? "", reasoning_content: step.reasoning ?? "",
      ...(step.tool ? { tool_calls: [{ index: 0, id: `call-${requests.length}`, type: "function", function: {
        name: step.tool, arguments: JSON.stringify(step.args ?? {}),
      } }] } : {}) };
    const chunk = { id: "boundary", object: "chat.completion.chunk", created: 1, model: "deepseek-flash",
      choices: [{ index: 0, delta, finish_reason: null }] };
    const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: step.finish ?? (step.tool ? "tool_calls" : "stop") }],
      usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  } });
  try {
    const task = { id: "boundary-task", parentTaskId: "prediction-task", chainId: "root-task", sessionId: session.sessionId, payload: options.request ? [{ type: "continuation_request", data: options.request }] : [] };
    const tools: ToolDefinition[] = [createIntentTool(), createTodoWriteTool(), { name: "dangerous", source: "builtin", description: "Forbidden in reconciliation", inputSchema: z.object({}),
      execute: async () => { dangerousCalls++; return { metadata: { ok: true, effect: "state_changed" } }; } }];
    const element = new StreamLLMElement({ name: "stream-llm", kind: "transform", bus,
      apiKey: "local-test", model: "deepseek-flash", baseUrl: server.url.toString(),
      beforeCall: options.beforeCall, tools, contextService: context, session, memory: options.memory, task, maxSteps: 5 });
    const result = await element.doProcess({ mode: "formatted", task: task as any, systemText: "Test task boundaries",
      userMessages: [{ role: "user", content: "世界文明史" }], abortSignal: options.abortSignal });
    const arbitrated = await new CheckFollowUpElement({ name: "check-follow-up", kind: "boundary", bus, session, decisionMode: "rules" }).doProcess(result);
    return { requests, result, arbitrated, todos: session.todoState, deltas, dangerousCalls, events };
  } finally { server.stop(true); context.stop(); }
}

test("intent ends the actual SDK loop without losing preceding content or reasoning", async () => {
  const trace = await run([{ text: "第一段正文", reasoning: "第一段推理", tool: "intent", args: {
    action: "follow_up", next_prompt: "继续当前段", summary: "第一段前半", avoid_repeat: "起源",
  } }]);
  expect(trace.requests).toHaveLength(1);
  expect(trace.result.responseText).toBe("第一段正文");
  expect(trace.result.reasoningContent).toBe("第一段推理");
  expect(trace.arbitrated.continuationDecision?.kind).toBe("resume_current");
  expect(trace.events.find(event => event.step === "stream-loop-ended")).toMatchObject({ exitReason: "intent_follow_up", taskId: "boundary-task" });
});

test("invalid intent returns a paired error and allows one corrected call", async () => {
  const trace = await run([
    { text: "已输出内容", reasoning: "思考", tool: "intent", args: { action: "invalid" } },
    { tool: "intent", args: { action: "follow_up", next_prompt: "继续" } },
  ]);
  expect(trace.requests).toHaveLength(2);
  expect(trace.requests[1].messages.some((message: any) => message.role === "tool" && message.content.includes("Invalid intent"))).toBe(true);
  expect(trace.requests[1].messages.some((message: any) => message.role === "assistant" && message.content === "已输出内容" && message.reasoning_content === "思考")).toBe(true);
  expect(trace.result.intents).toHaveLength(1);
});

test("creating a plan continues current work; finishing an item ends before the next item", async () => {
  const trace = await run([
    { tool: "todowrite", args: { todos: [one, two] } },
    { text: "文明起源正文", tool: "todowrite", args: { todos: [{ ...one, status: "completed" }, { ...two, status: "in_progress" }] } },
  ]);
  expect(trace.requests).toHaveLength(2);
  expect(trace.result.currentTodo).toEqual({ index: 0, content: one.content });
  expect(trace.result.todoHandoff).toBe(true);
  expect(trace.result.responseText).toBe("文明起源正文");
  expect(trace.arbitrated.continuationDecision?.kind).toBe("advance_todo");
  expect(trace.events.find(event => event.step === "stream-loop-ended")).toMatchObject({ exitReason: "todo_handoff", todoHandoff: true });
});

test("memory confirmation does not end the loop or request continuation", async () => {
  let retained = "";
  const trace = await run([
    { text: "确认前文", reasoning: "记忆推理", tool: "intent", args: { action: "retain_memory", mem_id: "abcdef" } },
    { text: "完整回答<<<COMPLETE>>>" },
  ], { memory: { findFullId: () => "abcdef-full", retain: (id: string) => { retained = id; } } });
  expect(retained).toBe("abcdef-full");
  expect(trace.requests).toHaveLength(2);
  expect(trace.requests[1].messages.some((message: any) => message.role === "tool" && message.tool_call_id === "call-1")).toBe(true);
  expect(trace.result.responseText).toBe("确认前文\n\n完整回答");
  expect(trace.result.intents).toHaveLength(0);
});

const request = { kind: "reconcile_progress", reason: "stale_progress", source: "rules", target: { index: 0, content: one.content } };
test("reconciliation exposes only todowrite and suppresses business text", async () => {
  const trace = await run([{ text: "这段业务正文不应显示", tool: "todowrite", args: { todos: [{ ...one, status: "completed" }, two] } }], { todos: [one, two], request });
  expect(trace.requests[0].tools.map((tool: any) => tool.function.name)).toEqual(["todowrite"]);
  expect(trace.result.responseText).toBe("");
  expect(trace.deltas).toEqual([]);
  expect(trace.arbitrated.continuationDecision?.kind).toBe("advance_todo");
  expect(trace.events.find(event => event.step === "reconciliation-result")).toMatchObject({
    taskId: "boundary-task", parentTaskId: "prediction-task", rootTaskId: "root-task", incomingContinuation: request,
    todoBefore: [one, two], todoAfter: [{ ...one, status: "completed" }, two], progressChanged: true, targetMatched: true,
    targetBefore: { todo: one }, targetAfter: { todo: { ...one, status: "completed" } },
    continuationDecision: trace.arbitrated.continuationDecision, chainAction: "continue_todo",
  });
});

test("reconciliation cannot execute a forged tool and stops after two attempts", async () => {
  const trace = await run([{ tool: "dangerous" }, { tool: "dangerous" }], { todos: [one, two], request });
  expect(trace.requests).toHaveLength(2);
  expect(trace.dangerousCalls).toBe(0);
  expect(trace.arbitrated.chainAction).toBeUndefined();
  expect(trace.arbitrated.suppressPostCheck).toBe(true);
  expect(trace.events.find(event => event.step === "stream-loop-ended")).toMatchObject({ exitReason: "reconciliation_attempt_limit", reconciliationAttempts: 2 });
});

test("successful but unchanged TODO update stops without another model call", async () => {
  const trace = await run([{ tool: "todowrite", args: { todos: [one, two] } }], { todos: [one, two], request });
  expect(trace.requests).toHaveLength(1);
  expect(trace.arbitrated.responseText).toContain("尚未确认");
  expect(trace.arbitrated.chainAction).toBeUndefined();
  expect(trace.events.find(event => event.step === "reconciliation-result")).toMatchObject({ progressChanged: false,
    continuationDecision: { kind: "finish", reason: "reconciliation_failed" }, chainAction: "none" });
});

test("natural stop records actual TODO tool exposure and preserves unfinished progress", async () => {
  const trace = await run([{ text: "第一段正文结束" }], { todos: [one, two] });
  expect(trace.requests).toHaveLength(1);
  expect(trace.requests[0].tools.some((tool: any) => tool.function.name === "todowrite")).toBe(true);
  expect(trace.todos).toEqual([one, two]);
  expect(trace.events.find(event => event.step === "model-step-ended")).toMatchObject({
    taskId: "boundary-task", todowriteAvailable: true, toolsEnabled: true, forceText: false,
    finishReason: "stop", toolCallCount: 0, currentTodoState: { todo: one },
  });
  expect(trace.events.find(event => event.step === "stream-loop-ended")).toMatchObject({
    exitReason: "no_tool_calls", finishReason: "stop", todowriteAvailable: true,
    todoBefore: [one, two], todoAfter: [one, two], todoHandoff: false, reconciliationAttempts: 0,
  });
  expect(trace.events.some(event => event.step === "decision-request")).toBe(false);
});


test("test proxy pacing runs before every SDK request without changing task boundaries", async () => {
  let calls = 0;
  const result = await run([
    { tool: "todowrite", args: { todos: [one, two] } },
    { text: "current section", tool: "todowrite", args: { todos: [{ ...one, status: "completed" }, { ...two, status: "in_progress" }] } },
  ], { beforeCall: async signal => { signal?.throwIfAborted(); calls++; await new Promise(resolve => setTimeout(resolve, 10)); } });
  expect(calls).toBe(2);
  expect(result.requests).toHaveLength(2);
  expect(result.result.responseText).toBe("current section");
});

test("cancelling while waiting for test proxy never starts a model request", async () => {
  const controller = new AbortController();
  const result = await run([{ text: "must not run" }], { abortSignal: controller.signal,
    beforeCall: async signal => { controller.abort(); signal?.throwIfAborted(); } });
  expect(result.requests).toHaveLength(0);
  expect(result.arbitrated.chainAction).toBeUndefined();
});
