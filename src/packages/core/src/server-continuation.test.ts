import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Logger } from "@atom-neo/shared";
import { clearRegistry, getRegisteredNames, resolveElement, registerElement } from "./pipeline/registry";
import { startCore } from "./server";
import { SessionContext } from "./session/context";
import { SessionPersistenceService } from "./session/persistence-service";
import { ContextService } from "./context/context-service";
import { makeBus } from "./pipelines/test-helpers";

const first = { content: "世界文明第一阶段", status: "in_progress", priority: "high" };
const second = { content: "世界文明第二阶段", status: "pending", priority: "high" };
async function scenario(kind: "reconcile" | "limit" | "checkpoint_failure" | "compression_limit" | "healthy_window" | "looping_window" | "global_resume" | "duplicate_resume") {
  const sandbox = mkdtempSync(join(tmpdir(), "atom-chain-test-"));
  const sid = `chain-${kind}`;
  const sessionPath = join(sandbox, ".atom", "sessions", createHash("sha256").update(sid).digest("hex").slice(0, 32));
  const logs: any[] = [];
  const requests: any[] = [];
  if (kind === "compression_limit") {
    const context = new ContextService(makeBus(), { sweepIntervalMs: 0 }); context.start();
    const session = new SessionContext(sid);
    session.resetForNewTopic("knowledge.general.other");
    session.setTodoState([first, second] as any);
    for (let i = 0; i < 40; i++) session.addMessage({ role: "assistant", content: `old diagnostic ${i}`, visible: false, timestamp: i });
    new SessionPersistenceService(sandbox, context).checkpoint(session, "message");
    context.stop();
  }
  let modelStep = 0;
  const modelServer = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body: any = await request.json(); requests.push(body);
    if (body.questions) {
      const selected: Record<string, string> = { difficulty: "medium", modelProfile: "balanced", intent: "creative",
        contextRelevance: kind === "compression_limit" ? "continuation" : "standalone", category: "knowledge", domain: "general", specific: "other",
        health: kind === "looping_window" ? "looping" : "healthy",
        continuation: "reconcile_progress", status: "satisfactory", behavior: "answered", contentState: "complete",
        coverage: "met", remainder: "none", reasonCode: "requirements_met", evidenceRef: "all_provided" };
      return Response.json({ model: "local", answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: any) => [id, {
        type: "choice", choice: selected[id] ?? "met", confidence: 1,
        probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, key === (selected[id] ?? "met") ? 1 : 0])),
      }])) });
    }
    if (kind === "compression_limit" && !body.stream) {
      return Response.json({ id: "summary", object: "chat.completion", created: 1, model: "local",
        choices: [{ index: 0, message: { role: "assistant", content: "世界文明史尚未开始，原有 TODO 保持未完成。" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    }
    const n = modelStep++;
    let content = "";
    let tool: any;
    let finish = "stop";
    if (kind === "compression_limit") { content = n === 0 ? "前文尚未完成" : ""; finish = n === 0 ? "length" : "stop"; }
    else if (kind !== "reconcile") {
      content = `未完成正文${n}`;
      finish = (kind === "healthy_window" && n === 6) || (["global_resume", "duplicate_resume"].includes(kind) && n === 2) ? "stop" : "length";
    }
    else if (n === 0) tool = { name: "todowrite", args: { todos: [first, second] } };
    else if (n === 1) { content = "第一阶段已输出，第二阶段也已输出。<<<COMPLETE>>>"; }
    else if (n === 2) tool = { name: "todowrite", args: { todos: [{ ...first, status: "completed" }, { ...second, status: "completed" }] } };
    else throw new Error("Unexpected repeated content generation");
    if (kind === "checkpoint_failure") {
      // The user checkpoint succeeded already. Make only the assistant checkpoint fail.
      renameSync(join(sessionPath, ".checkpoints"), join(sessionPath, ".checkpoints-backup"));
      await Bun.write(join(sessionPath, ".checkpoints"), "block checkpoint directory");
    }
    const delta: any = { role: "assistant", content };
    if (tool) delta.tool_calls = [{ index: 0, id: `call-${n}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.args) } }];
    const chunk = { id: "local", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta, finish_reason: null }] };
    const promptTokens = kind === "compression_limit" ? 200_000 : 100;
    const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : finish }], usage: { prompt_tokens: promptTokens, completion_tokens: 5, total_tokens: promptTokens + 5 } };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  } });
  const runtime: any = { sandbox, maxTokens: 100, appConfig: { conversation: kind === "healthy_window" || kind === "looping_window" ? { maxGlobalRounds: 100, maxLocalRounds: 5 } : { maxChainDepth: 1 },
    decisionMode: { prediction: "jev", postConversation: "jev", continuation: "jev" }, providers: {} },
    getResolvedModel(profile: string) { return { provider: "local", model: "local", apiKey: "local-test",
      type: profile === "fast" ? "jev" : "llm", baseUrl: modelServer.url.toString(), thinking: "disabled" }; } };
  const registered = getRegisteredNames().map(name => [name, resolveElement(name)] as const);
  clearRegistry();
  const core = await startCore({ port: 0, host: "127.0.0.1", sandbox, logger: new Logger("debug", entry => logs.push(entry)),
    runtime, sm: { get: (name: string) => name === "network" ? {} as any : undefined } } as any);
  try {
    const url = `http://127.0.0.1:${core.port}`;
    const submitted: any = await (await fetch(`${url}/api/tasks`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, data: { text: "请写世界文明史" } }) })).json();
    for (let i = 0; i < 200; i++) {
      const health: any = await (await fetch(`${url}/api/health`)).json();
      if (logs.some(entry => entry.message === "task pipeline completed") && health.queue.waiting === 0 && health.queue.processing === 0) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    let resumed: any;
    if (["global_resume", "duplicate_resume"].includes(kind)) {
      resumed = await (await fetch(`${url}/api/tasks`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, data: { text: "继续" } }) })).json();
      if (kind === "duplicate_resume") {
        const duplicate = await (await fetch(`${url}/api/tasks`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, data: { text: "CONTINUE" } }) })).json();
        expect(duplicate.reason).toBe("already_running");
      }
      for (let i = 0; i < 200; i++) {
        const health: any = await (await fetch(`${url}/api/health`)).json();
        if (modelStep === 3 && health.queue.waiting === 0 && health.queue.active === 0 && health.queue.processing === 0) break;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
    const messages: any = await (await fetch(`${url}/api/sessions/${sid}`)).json();
    const status: any = await (await fetch(`${url}/api/tasks/${submitted.taskId}`)).json();
    const state = kind === "checkpoint_failure" ? undefined : JSON.parse(readFileSync(join(sessionPath, "session.json"), "utf8"));
    return { requests, logs, messages, status, state, modelStep, resumed };
  } finally {
    if (kind === "checkpoint_failure") {
      rmSync(join(sessionPath, ".checkpoints"), { force: true });
      renameSync(join(sessionPath, ".checkpoints-backup"), join(sessionPath, ".checkpoints"));
    }
    await core.stop(); modelServer.stop(true); rmSync(sandbox, { recursive: true, force: true });
    clearRegistry(); for (const [name, ctor] of registered) registerElement(name, ctor);
  }
}

test("full Core reconciles stale TODO after completion without repeating the world-civilization answer", async () => {
  const result = await scenario("reconcile");
  expect(result.modelStep).toBe(3);
  expect(result.state.todoState.every((todo: any) => todo.status === "completed")).toBe(true);
  expect(result.messages.filter((message: any) => message.visible && message.role === "assistant").map((message: any) => message.content)).toEqual(["第一阶段已输出，第二阶段也已输出。"]);
  const repair = result.requests.filter((request: any) => !request.questions).at(-1);
  expect(repair.tools.map((tool: any) => tool.function.name)).toEqual(["todowrite"]);
  const captured = result.logs.filter(entry => entry.message.endsWith(": decision-request"));
  const sent = result.requests.filter(request => request.questions);
  expect(captured).toHaveLength(sent.length);
  for (let i = 0; i < sent.length; i++) {
    expect(JSON.parse(JSON.stringify(captured[i].context.state))).toEqual(sent[i].state);
    expect(captured[i].context.questions).toEqual(sent[i].questions);
    expect(captured[i].context).not.toHaveProperty("apiKey");
  }
  const arbitration = captured.find(entry => entry.context.purpose === "continuation").context;
  const staged = result.logs.find(entry => entry.message === "orchestrator: task-staged"
    && entry.context.continuation?.kind === "reconcile_progress").context;
  expect(staged.requestedByTaskId).toBe(arbitration.taskId);
  const reconciled = result.logs.find(entry => entry.message === "check-follow-up: reconciliation-result").context;
  expect(reconciled.taskId).toBe(staged.taskId);
  expect(reconciled.progressChanged).toBe(true);
  expect(reconciled.continuationDecision).toMatchObject({ kind: "finish", reason: "progress_reconciled" });
});

test("full Core reports the chain limit and never schedules another continuation", async () => {
  const result = await scenario("limit");
  expect(result.modelStep).toBe(2);
  expect(result.messages.at(-1).content).toContain("轮次上限");
  expect(result.state.executionBudget.globalUsed).toBe(2);
  expect(result.logs.find(entry => entry.message === "execution budget: global-limit").context.after)
    .toMatchObject({ globalUsed: 2, globalAllowance: 2, pendingTask: { payload: expect.arrayContaining([expect.objectContaining({ type: "continuation_request", data: expect.objectContaining({ kind: "resume_current" }) })]) } });
});

test("failed assistant checkpoint discards continuation before enqueue", async () => {
  const result = await scenario("checkpoint_failure");
  expect(result.modelStep).toBe(1);
  expect(result.logs.some(entry => entry.message === "session checkpoint failed after task completion")).toBe(true);
  expect(result.logs.some(entry => entry.message === "conversation chain: handler entered")).toBe(false);
});

test("compression recovery shares the continuation depth limit and preserves unfinished TODO", async () => {
  const result = await scenario("compression_limit");
  expect(result.modelStep).toBe(2);
  expect(result.logs.filter(entry => entry.message === "conversation chain: handler entered")).toHaveLength(2);
  expect(result.state.executionBudget.globalUsed).toBe(2);
  expect(result.state.todoState).toEqual([first, second]);
  expect(result.messages.at(-1).content).toContain("轮次上限");
});


test("full Core crosses a five-round window with global usage intact and one health check", async () => {
  const result = await scenario("healthy_window");
  expect(result.modelStep).toBe(7);
  expect(result.state.executionBudget).toMatchObject({ globalUsed: 7, localUsed: 2, windowId: 1, globalAllowance: 100, completed: true });
  expect(result.requests.filter(request => request.questions?.health)).toHaveLength(1);
  expect(result.logs.filter(entry => entry.message === "execution budget: released")).toHaveLength(7);
});

test("full Core looping window pauses before releasing the sixth reply", async () => {
  const result = await scenario("looping_window");
  expect(result.modelStep).toBe(5);
  expect(result.state.executionBudget).toMatchObject({ globalUsed: 5, localUsed: 5, pause: "unhealthy" });
  expect(result.messages.findLast((message: any) => message.visible !== false).content).toContain("任务尚未确认完成");
  expect(result.requests.filter(request => request.questions?.health)).toHaveLength(1);
});

test("exact resume control bypasses Prediction and preserves original goal and cumulative count", async () => {
  const result = await scenario("global_resume");
  expect(result.modelStep).toBe(3);
  expect(result.state.executionBudget).toMatchObject({ globalUsed: 3, globalAllowance: 4, goal: "请写世界文明史" });
  expect(result.requests.filter(request => request.questions?.contextRelevance)).toHaveLength(1);
  expect(result.messages.filter((message: any) => message.role === "user").map((message: any) => message.content)).toEqual(["请写世界文明史", "继续"]);
});


test("duplicate resume while the original goal is running neither adds allowance nor starts Prediction", async () => {
  const result = await scenario("duplicate_resume");
  expect(result.state.executionBudget).toMatchObject({ globalUsed: 3, globalAllowance: 4 });
  expect(result.requests.filter(request => request.questions?.contextRelevance)).toHaveLength(1);
});
