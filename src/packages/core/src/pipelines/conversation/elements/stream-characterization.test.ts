import { expect, test } from "bun:test";
import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import { ContextService } from "@core/context/context-service";
import { SessionContext } from "@core/session/context";
import { createIntentTool } from "@core/tools/builtin/intent";
import { makeBus } from "@core/pipelines/test-helpers";
import { StreamLLMElement } from "./stream-llm";

/**
 * S12-A1 behavior snapshot.
 *
 * Records, in event order:
 * - `BusEvents.Element.Data` step names (no timestamps/durations).
 * - `Transport.Reason/Delta/ToolStarted/ToolFinished/ToolStepFinished/ToolGroupComplete`
 *   with payloads minus volatile ids.
 * - `Context.StepCompleted` payloads.
 * - request bodies as `messages` role/tool_calls/name summaries (no ids/created).
 * - result projection fields used by the Task/Pipeline contract.
 */

type Step = { text?: string; reasoning?: string; tool?: string; args?: unknown; finish?: string };
type RequestSummary = {
  messages: Array<{
    role: string;
    content?: unknown;
    tool_calls?: string[];
    tool_call_id?: string;
    name?: string;
  }>;
  tools: string[];
};

const todoA = { content: "文明起源", status: "pending", priority: "high" } as const;

function summarizeRequest(body: any): RequestSummary {
  return {
    messages: (body.messages ?? []).map((message: any) => ({
      role: message.role,
      ...(message.content === undefined ? {} : { content: message.content }),
      ...(message.tool_calls ? { tool_calls: message.tool_calls.map((call: any) => call.function.name) } : {}),
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
      ...(message.name ? { name: message.name } : {}),
    })),
    tools: (body.tools ?? []).map((item: any) => item.function.name),
  };
}

async function runScenario(
  steps: Step[],
  options: {
    beforeCall?: (signal?: AbortSignal) => Promise<void>;
    abortSignal?: AbortSignal;
    contextTokens?: number;
  } = {},
) {
  const requests: RequestSummary[] = [];
  const dataSteps: string[] = [];
  const transport: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const completedSteps: Array<{ sessionId: string; taskId: string; stepId: string }> = [];
  const bus = makeBus();
  bus.on(BusEvents.Element.Data, ({ payload }) => dataSteps.push(String(payload.step)));
  bus.on(BusEvents.Transport.Reason, ({ payload }) => transport.push({ event: "reason", payload: { ...payload } }));
  bus.on(BusEvents.Transport.Delta, ({ payload }) => transport.push({ event: "delta", payload: { ...payload } }));
  bus.on(BusEvents.Transport.ToolStarted, ({ payload }) => transport.push({
    event: "tool-started",
    payload: { toolName: payload.toolName, toolCallId: payload.toolCallId, input: payload.input },
  }));
  bus.on(BusEvents.Transport.ToolFinished, ({ payload }) => transport.push({
    event: "tool-finished",
    payload: {
      toolName: payload.toolName,
      toolCallId: payload.toolCallId,
      ...(payload.result === undefined ? {} : { result: payload.result }),
      ...(payload.error === undefined ? {} : { error: payload.error }),
    },
  }));
  bus.on(BusEvents.Transport.ToolStepFinished, ({ payload }) => transport.push({
    event: "tool-step-finished",
    payload: { stepNumber: payload.stepNumber, total: payload.total, success: payload.success, failed: payload.failed, toolNames: payload.toolNames },
  }));
  bus.on(BusEvents.Transport.ToolGroupComplete, ({ payload }) => transport.push({
    event: "tool-group-complete",
    payload: { total: payload.total, success: payload.success, failed: payload.failed, toolNames: payload.toolNames },
  }));
  bus.on(BusEvents.Context.StepCompleted, payload => completedSteps.push({
    sessionId: payload.sessionId,
    taskId: payload.taskId,
    stepId: payload.stepId,
  }));

  const context = new ContextService(bus, { sweepIntervalMs: 0 });
  context.start();
  const session = new SessionContext("characterization-session");
  session.setContextTokens(options.contextTokens ?? 0);
  session.addMessage({ role: "user", content: "世界文明史", timestamp: Date.now(), visible: true });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push(summarizeRequest(await request.json()));
      const step = steps[requests.length - 1];
      if (!step) return Response.json({ error: { message: "unexpected extra generation" } }, { status: 400 });
      const delta = {
        role: "assistant",
        content: step.text ?? "",
        reasoning_content: step.reasoning ?? "",
        ...(step.tool ? {
          tool_calls: [{
            index: 0,
            id: `call-${requests.length}`,
            type: "function",
            function: { name: step.tool, arguments: JSON.stringify(step.args ?? {}) },
          }],
        } : {}),
      };
      const chunk = { id: "characterization", object: "chat.completion.chunk", created: 1, model: "deepseek-flash",
        choices: [{ index: 0, delta, finish_reason: null }] };
      const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: step.finish ?? (step.tool ? "tool_calls" : "stop") }],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });

  try {
    const task = {
      id: "characterization-task",
      parentTaskId: "prediction-task",
      chainId: "root-task",
      sessionId: session.sessionId,
      payload: [],
    };
    const tools: ToolDefinition[] = [
      createIntentTool(),
      { name: "probe", source: "builtin", description: "Record a probe", inputSchema: z.object({ value: z.string() }),
        execute: async args => ({ content: `probe:${(args as any).value}`, metadata: { ok: true, effect: "state_changed" } }) },
    ];
    const element = new StreamLLMElement({
      name: "stream-llm",
      kind: "transform",
      bus,
      apiKey: "local-test",
      model: "deepseek-flash",
      baseUrl: server.url.toString(),
      beforeCall: options.beforeCall,
      tools,
      contextService: context,
      session,
      task: task as any,
      maxSteps: 5,
    });
    const result = await element.doProcess({
      mode: "formatted",
      task: task as any,
      systemText: "Characterization",
      userMessages: [{ role: "user", content: "世界文明史" }],
      abortSignal: options.abortSignal,
    });
    return {
      requests,
      dataSteps,
      transport,
      completedSteps,
      result: {
        mode: result.mode,
        responseText: result.responseText,
        reasoningContent: result.reasoningContent,
        intentKinds: (result.intents ?? []).map(intent => intent.request),
        intentParams: (result.intents ?? []).map(intent => intent.params),
        tokenUsage: result.tokenUsage,
        todoBefore: result.todoBefore,
        currentTodo: result.currentTodo,
        todoHandoff: result.todoHandoff,
        toolStopReason: result.toolStopReason,
        streamInterrupted: result.streamInterrupted,
        cancelled: result.cancelled,
        tokenOverflow: result.tokenOverflow,
        errorStatusCode: result.errorStatusCode,
        finishReason: result.finishReason,
        completeDetected: result.completeDetected,
        toolEffectSummary: result.toolEffectSummary,
        contextSnapshotAccepted: result.contextSnapshotAccepted,
      },
    };
  } finally {
    server.stop(true);
    context.stop();
  }
}

function resultSnapshot(result: any) {
  return JSON.parse(JSON.stringify(result));
}

test("plain response keeps the data/transport/result contract", async () => {
  const trace = await runScenario([{ text: "你好", reasoning: "想一想" }]);
  expect(trace.requests).toEqual([
    {
      messages: [
        { role: "system", content: "Characterization" },
        { role: "user", content: "世界文明史" },
      ],
      tools: ["intent", "probe"],
    },
  ]);
  expect(trace.dataSteps).toEqual([
    "starting LLM call",
    "model-step-usage",
    "model-step-ended",
    "stream-loop-ended",
    "done",
  ]);
  expect(trace.transport).toEqual([
    { event: "reason", payload: {
      sessionId: "characterization-session", taskId: "characterization-task", textDelta: "想一想", offset: 0,
    } },
    { event: "delta", payload: {
      sessionId: "characterization-session", taskId: "characterization-task", textDelta: "你好", offset: 0,
    } },
  ]);
  expect(trace.completedSteps).toEqual([
    { sessionId: "characterization-session", taskId: "characterization-task", stepId: "0" },
  ]);
  expect(resultSnapshot(trace.result)).toEqual({
    mode: "executing",
    responseText: "你好",
    reasoningContent: "想一想",
    intentKinds: [],
    intentParams: [],
    tokenUsage: { total: 105 },
    todoBefore: [],
    todoHandoff: false,
    streamInterrupted: false,
    cancelled: false,
    tokenOverflow: false,
    errorStatusCode: 0,
    finishReason: "stop",
    completeDetected: false,
    toolEffectSummary: { evidence: 0, referenceEvidence: 0, stateChanged: 0, none: 0, failed: 0 },
    contextSnapshotAccepted: true,
  });
});

test("tool call keeps governance, transport, and record ordering", async () => {
  const trace = await runScenario([
    { text: "准备", reasoning: "计划", tool: "probe", args: { value: "x" } },
    { text: "完成" },
  ]);
  expect(trace.requests).toEqual([
    {
      messages: [
        { role: "system", content: "Characterization" },
        { role: "user", content: "世界文明史" },
      ],
      tools: ["intent", "probe"],
    },
    {
      messages: [
        { role: "system", content: "Characterization" },
        { role: "user", content: "世界文明史" },
        { role: "assistant", content: "准备", tool_calls: ["probe"] },
        { role: "tool", content: "probe:x", tool_call_id: "call-1" },
      ],
      tools: ["intent", "probe"],
    },
  ]);
  expect(trace.dataSteps).toEqual([
    "starting LLM call",
    "model-step-usage",
    "model-step-ended",
    "tool-call-start",
    "tool-governance-decision",
    "tool-execute-start",
    "tool-execute-done",
    "tool-governance-result",
    "tool-call-finish",
    "model-step-usage",
    "model-step-ended",
    "stream-loop-ended",
    "done",
  ]);
  expect(trace.transport).toEqual([
    { event: "reason", payload: {
      sessionId: "characterization-session", taskId: "characterization-task", textDelta: "计划", offset: 0,
    } },
    { event: "delta", payload: {
      sessionId: "characterization-session", taskId: "characterization-task", textDelta: "准备", offset: 0,
    } },
    { event: "tool-started", payload: { toolName: "probe", toolCallId: "call-1", input: { value: "x" } } },
    { event: "tool-finished", payload: { toolName: "probe", toolCallId: "call-1", result: "probe:x" } },
    { event: "tool-step-finished", payload: {
      stepNumber: 0, total: 1, success: 1, failed: 0, toolNames: ["probe"],
    } },
    { event: "delta", payload: {
      sessionId: "characterization-session", taskId: "characterization-task", textDelta: "\n\n完成", offset: 2,
    } },
    { event: "tool-group-complete", payload: { total: 1, success: 1, failed: 0, toolNames: ["probe"] } },
  ]);
  expect(trace.completedSteps).toEqual([
    { sessionId: "characterization-session", taskId: "characterization-task", stepId: "0" },
    { sessionId: "characterization-session", taskId: "characterization-task", stepId: "1" },
  ]);
  expect(resultSnapshot(trace.result)).toEqual({
    mode: "executing",
    responseText: "准备\n\n完成",
    reasoningContent: "计划",
    intentKinds: [],
    intentParams: [],
    tokenUsage: { total: 210 },
    todoBefore: [],
    todoHandoff: false,
    streamInterrupted: false,
    cancelled: false,
    tokenOverflow: false,
    errorStatusCode: 0,
    finishReason: "stop",
    completeDetected: false,
    toolEffectSummary: { evidence: 0, referenceEvidence: 0, stateChanged: 1, none: 0, failed: 0 },
    contextSnapshotAccepted: true,
  });
});

test("intent follow-up ends the loop with the same result projection", async () => {
  const trace = await runScenario([
    { text: "第一段", reasoning: "推理", tool: "intent", args: { action: "follow_up", next_prompt: "继续", summary: "摘要", avoid_repeat: "重复" } },
  ]);
  expect(trace.requests).toEqual([
    {
      messages: [
        { role: "system", content: "Characterization" },
        { role: "user", content: "世界文明史" },
      ],
      tools: ["intent", "probe"],
    },
  ]);
  expect(trace.dataSteps).toEqual([
    "starting LLM call",
    "model-step-usage",
    "model-step-ended",
    "tool-call-start",
    "stream-loop-ended",
    "done",
  ]);
  expect(trace.transport).toEqual([
    { event: "reason", payload: {
      sessionId: "characterization-session", taskId: "characterization-task", textDelta: "推理", offset: 0,
    } },
    { event: "delta", payload: {
      sessionId: "characterization-session", taskId: "characterization-task", textDelta: "第一段", offset: 0,
    } },
    { event: "tool-started", payload: { toolName: "intent", toolCallId: "call-1", input: {
      action: "follow_up", next_prompt: "继续", summary: "摘要", avoid_repeat: "重复",
    } } },
    { event: "tool-finished", payload: { toolName: "intent", toolCallId: "call-1", result: "Intent received" } },
    { event: "tool-step-finished", payload: {
      stepNumber: 0, total: 1, success: 1, failed: 0, toolNames: ["intent"],
    } },
    { event: "tool-group-complete", payload: { total: 1, success: 1, failed: 0, toolNames: ["intent"] } },
  ]);
  expect(trace.completedSteps).toEqual([
    { sessionId: "characterization-session", taskId: "characterization-task", stepId: "0" },
  ]);
  expect(resultSnapshot(trace.result)).toEqual({
    mode: "executing",
    responseText: "第一段",
    reasoningContent: "推理",
    intentKinds: ["follow_up"],
    intentParams: [{ action: "follow_up", next_prompt: "继续", summary: "摘要", avoid_repeat: "重复" }],
    tokenUsage: { total: 105 },
    todoBefore: [],
    todoHandoff: false,
    streamInterrupted: false,
    cancelled: false,
    tokenOverflow: false,
    errorStatusCode: 0,
    finishReason: "tool-calls",
    completeDetected: false,
    toolEffectSummary: { evidence: 0, referenceEvidence: 0, stateChanged: 0, none: 1, failed: 0 },
    contextSnapshotAccepted: true,
  });
});

test("token overflow short-circuits before the done projection", async () => {
  const trace = await runScenario([{ text: "" }], { contextTokens: 120_000 });
  expect(trace.requests).toHaveLength(1);
  expect(trace.dataSteps).toEqual([
    "starting LLM call",
    "model-step-usage",
    "model-step-ended",
    "stream-loop-ended",
    "token-overflow-detected",
  ]);
  expect(trace.transport).toEqual([]);
  expect(trace.completedSteps).toEqual([
    { sessionId: "characterization-session", taskId: "characterization-task", stepId: "0" },
  ]);
  expect(resultSnapshot(trace.result)).toEqual({
    mode: "executing",
    responseText: "",
    reasoningContent: "",
    intentKinds: [],
    intentParams: [],
    tokenUsage: { total: 0 },
    todoBefore: [],
    tokenOverflow: true,
    contextSnapshotAccepted: false,
  });
});

test("abort before the model request preserves cancellation projection", async () => {
  const controller = new AbortController();
  const trace = await runScenario([{ text: "must not run" }], {
    abortSignal: controller.signal,
    beforeCall: async signal => { controller.abort(); signal?.throwIfAborted(); },
  });
  expect(trace.requests).toEqual([]);
  expect(trace.dataSteps).toEqual(["starting LLM call", "error", "stream-loop-ended", "done"]);
  expect(trace.transport).toEqual([]);
  expect(trace.completedSteps).toEqual([]);
  expect(resultSnapshot(trace.result)).toEqual({
    mode: "executing",
    responseText: "工具循环执行失败。",
    reasoningContent: "",
    intentKinds: [],
    intentParams: [],
    tokenUsage: { total: 0 },
    todoBefore: [],
    todoHandoff: false,
    streamInterrupted: true,
    cancelled: true,
    tokenOverflow: false,
    errorStatusCode: 0,
    finishReason: "error",
    completeDetected: false,
    toolEffectSummary: { evidence: 0, referenceEvidence: 0, stateChanged: 0, none: 0, failed: 0 },
    contextSnapshotAccepted: false,
  });
});
