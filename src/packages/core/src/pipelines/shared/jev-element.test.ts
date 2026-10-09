import { buildAssistantReview } from "../post-conversation/elements/collect-input";
import { describe, expect, test } from "bun:test";
import { makeBus } from "../test-helpers";
import { JevElement, composeTopic, TOPIC_CHOICES } from "./jev-element";
import { getRegisteredNames } from "../../pipeline/registry";
import { predictionPipeline, registerPredictionElements } from "../prediction";
import { postConversationPipeline, registerPostConversationElements } from "../post-conversation";
import { registerSharedElements } from ".";
import { BusEvents } from "@atom-neo/shared";

const choose = (questions: Record<string, { criteria: Record<string, unknown> }>, selected: Record<string, string>) =>
  Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, {
    type: "choice",
    choice: selected[id],
    probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === selected[id] ? 1 : 0])),
    confidence: 1,
  }]));

describe("JevElement", () => {
  test("both pipelines select JevElement independently and preserve legacy transforms", () => {
    if (!getRegisteredNames().includes("predict-input")) registerPredictionElements();
    if (!getRegisteredNames().includes("post-collect-input")) registerPostConversationElements();
    registerSharedElements();
    const decision = { type: "jev" as const, apiKey: "key", model: "typesafe/jev-1.13" };
    const fallback = { apiKey: "llm-key", model: "deepseek-v4-flash" };
    const predictionDeps = {
      session: {}, task: {}, apiKey: "llm-key", model: "deepseek-v4-flash", orchestrator: {} as any,
      decisionModel: decision, fallbackModel: fallback,
    };
    const postDeps = {
      session: {}, task: {}, apiKey: "llm-key", model: "deepseek-v4-flash", contextService: {} as any,
      decisionModel: decision, fallbackModel: fallback,
    };
    const names = (items: { elements: Array<{ name: string }> }) => items.elements.map(item => item.name);
    expect(names(predictionPipeline({ ...predictionDeps, decisionMode: "jev" }).build(makeBus()))).toContain("jev-decision");
    expect(names(predictionPipeline(predictionDeps).build(makeBus()))).toContain("predict-intent");
    expect(names(postConversationPipeline({ ...postDeps, decisionMode: "jev" }).build(makeBus()))).toContain("jev-decision");
    expect(names(postConversationPipeline(postDeps).build(makeBus()))).toContain("post-analyze-result");
  });

  test("composes only a registered topic from component scores", () => {
    const topic = composeTopic({
      category: { choice: "code", probabilities: { code: 0.9 } },
      domain: { choice: "debugging", probabilities: { debugging: 0.8 } },
      specific: { choice: "issue", probabilities: { issue: 0.7 } },
    });
    expect(topic).toBe("code.debugging.issue");
    expect(topic in TOPIC_CHOICES).toBe(true);
  });

  test("uses direct Jev response for prediction without the AI SDK", async () => {
    let sent: any;
    const bus = makeBus();
    const updates: Record<string, unknown>[] = [];
    const requests: Record<string, unknown>[] = [];
    bus.on(BusEvents.Element.Data, ({ payload }) => { if (payload.step === "decision-updated") updates.push(payload); });
    bus.on(BusEvents.Element.Data, ({ payload }) => { if (payload.step === "decision-request") requests.push(payload); });
    const element = new JevElement({
      name: "jev-decision", kind: "transform", bus, purpose: "prediction",
      model: { type: "jev", apiKey: "test-key", model: "typesafe/jev-1.13", baseUrl: "https://decisions.example.test/v1" },
      fallback: { apiKey: "llm-key", model: "deepseek-v4-flash" },
      fetchImpl: async (url, init) => {
        expect(url).toBe("https://decisions.example.test/v1");
        sent = JSON.parse(String(init.body));
        return Response.json({ model: "typesafe/jev-1.13", answers: choose(sent.questions, {
          difficulty: "medium", modelProfile: "balanced", intent: "instruction", contextRelevance: "standalone",
          category: "code", domain: "debugging", specific: "issue",
        }) });
      },
    });
    const result = await element.doProcess({
      mode: "predicting", task: { id: "task-1", chainId: "root-1", sessionId: "session-1" }, session: {}, userMessage: "修复这个问题", currentTopic: "",
    });
    expect(sent.state.userInput).toBe("修复这个问题");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ purpose: "prediction", taskId: "task-1", rootTaskId: "root-1", source: "jev", ...sent });
    expect(requests[0]).not.toHaveProperty("apiKey");
    expect(result.mode).toBe("routing");
    expect((result as any).prediction).toMatchObject({ intent: "instruction", topic: "code.debugging.issue" });
    expect(updates).toMatchObject([
      { state: "run", source: "jev", rootTaskId: "root-1" },
      { state: "ok", source: "jev", topic: "code.debugging.issue" },
    ]);
  });

  test("uses LLM simulation when Jev credentials are missing", async () => {
    let simulated = false;
    const bus = makeBus();
    const updates: Record<string, unknown>[] = [];
    bus.on(BusEvents.Element.Data, ({ payload }) => { if (payload.step === "decision-updated") updates.push(payload); });
    const element = new JevElement({
      name: "jev-decision", kind: "transform", bus, purpose: "post-conversation",
      model: { type: "jev", apiKey: "", model: "typesafe/jev-1.13" },
      fallback: { apiKey: "llm-key", model: "deepseek-v4-flash" },
      simulate: async (_state, _questions, _signal, model) => { simulated = true; expect(model?.model).toBe("deepseek-v4-flash"); return { status: "blocked", behavior: "intent_only" }; },
    });
    const result = await element.doProcess({
      mode: "analyzing", task: { id: "post-1", chainId: "root-1", sessionId: "session-1" }, session: {}, userMessage: "查天气", assistantResponse: "我来查", predictedTaskIntent: "instruction",
      stepCount: 1, assistantParts: 1, assistantLength: 3, activeTodoCount: 0, finishReason: "stop",
      completeDetected: false, toolEffectSummary: { evidence: 0, referenceEvidence: 0, stateChanged: 0, none: 0, failed: 0 },
    });
    expect(simulated).toBe(true);
    expect(result.mode).toBe("acting");
    expect((result as any).analysis).toMatchObject({ status: "blocked", fingerprint: "intent_only" });
    expect(updates).toMatchObject([
      { state: "run", source: "llm", rootTaskId: "root-1" },
      { state: "ok", source: "llm", analysisStatus: "blocked" },
    ]);
  });

  test("does not send Jev requests when the provider has no endpoint", async () => {
    let sent = false;
    const element = new JevElement({
      name: "jev-decision", kind: "transform", bus: makeBus(), purpose: "prediction",
      model: { type: "jev", apiKey: "jev-key", model: "other/decision-model" },
      fallback: { apiKey: "llm-key", model: "deepseek-v4-flash" },
      fetchImpl: async () => { sent = true; throw new Error("unexpected network call"); },
      simulate: async (_state, _questions, _signal, model) => {
        expect(model?.model).toBe("deepseek-v4-flash");
        return { difficulty: "easy", modelProfile: "basic", intent: "question", contextRelevance: "standalone", category: "knowledge", domain: "general", specific: "other" };
      },
    });
    const result = await element.doProcess({ mode: "predicting", task: {}, session: {}, userMessage: "问题", currentTopic: "" });
    expect(sent).toBe(false);
    expect((result as any).prediction.topic).toBe("knowledge.general.other");
  });

  test("uses the fast LLM itself when configured instead of the basic fallback", async () => {
    const element = new JevElement({
      name: "jev-decision", kind: "transform", bus: makeBus(), purpose: "post-conversation",
      model: { type: "llm", apiKey: "fast-key", model: "fast-model" },
      fallback: { apiKey: "basic-key", model: "basic-model" },
      simulate: async (_state, _questions, _signal, model) => {
        expect(model?.model).toBe("fast-model");
        return { status: "satisfactory", behavior: "answered" };
      },
    });
    const result = await element.doProcess({
      mode: "analyzing", task: {}, session: {}, userMessage: "你好", assistantResponse: "你好", predictedTaskIntent: "conversation",
      stepCount: 1, assistantParts: 1, assistantLength: 2, activeTodoCount: 0, finishReason: "stop",
      completeDetected: true, toolEffectSummary: { evidence: 0, referenceEvidence: 0, stateChanged: 0, none: 0, failed: 0 },
    });
    expect((result as any).analysis.status).toBe("satisfactory");
  });

  test("reports a failed decision without exposing the provider error to the sidebar event", async () => {
    const bus = makeBus();
    const updates: Record<string, unknown>[] = [];
    bus.on(BusEvents.Element.Data, ({ payload }) => { if (payload.step === "decision-updated") updates.push(payload); });
    const element = new JevElement({
      name: "jev-decision", kind: "transform", bus, purpose: "prediction",
      model: { type: "jev", apiKey: "", model: "typesafe/jev-1.13" },
      fallback: { apiKey: "llm-key", model: "deepseek-v4-flash" },
      simulate: async () => { throw new Error("private provider detail"); },
    });
    const result = await element.doProcess({
      mode: "predicting", task: { id: "task-1", chainId: "root-1", sessionId: "session-1" },
      session: {}, userMessage: "问题", currentTopic: "",
    });
    expect(result.mode).toBe("routing");
    expect(updates.map(update => update.state)).toEqual(["run", "err"]);
    expect(updates[1]).not.toHaveProperty("error");
  });
});


test.each(["partial_work", "no_output"])("post review rejects satisfactory with contradictory %s", async behavior => {
  const review = buildAssistantReview([{ seq: 7, content: "实际输出" }]);
  let captured: any;
  const element = new JevElement({ name: "jev-decision", kind: "transform", bus: makeBus(), purpose: "post-conversation",
    model: { type: "llm", apiKey: "test", model: "fast" }, fallback: { apiKey: "test", model: "basic" },
    simulate: async (state, questions) => { captured = state;
      expect(Object.keys(questions)).toEqual(["status", "behavior", "contentState", "reasonCode", "evidenceRef"]);
      return { status: "satisfactory", behavior, contentState: "complete", reasonCode: "requirements_met", evidenceRef: "7" };
    },
  });
  const result = await element.doProcess({ mode: "analyzing", task: {} as any, session: {}, userMessage: "写正文",
    assistantResponse: review.response, predictedTaskIntent: "creative", stepCount: 0, ...review } as any);
  expect((result as any).analysis.status).toBe("blocked");
  expect((result as any).analysis.reason).toBe("inconsistent_success: requirements_met");
  expect(captured.progressEvidence.outputRefs[0]).not.toHaveProperty("text");
});
