import { describe, test, expect, beforeAll } from "bun:test";
import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { registerPredictionElements, predictionPipeline } from "../index";
import { resolveElement } from "../../pipeline/registry";

beforeAll(() => {
  registerPredictionElements();
});

function makeBus() {
  return new PipelineEventBus<FullEventMap>();
}

function makeMockOrchestrator(capture: { enqueued: any } | null) {
  return {
    scheduleConversation: (sid: string, cid: string, ptid: string, payload?: any[]) => {
      if (capture) capture.enqueued = { pipeline: "conversation", parentTaskId: ptid, payload };
    },
    scheduleEvaluator: () => {},
    scheduleCompress: () => {},
    scheduleFollowUp: () => {},
  };
}

describe("prediction pipeline elements", () => {
  test("predict-input extracts user message from task payload", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("predict-input");
    const el = new Ctor({
      name: "predict-input",
      kind: "source",
      bus,
      session: null,
      task: { payload: [{ data: "hello world" }] },
    });

    const result = await el.doProcess({ mode: "initial", task: { payload: [{ data: "hello world" }] } });
    expect(result.mode).toBe("predicting");
    expect(result.userMessage).toBe("hello world");
  });

  test("predict-input builds context from session messages", async () => {
    const bus = makeBus();
    const session = {
      sessionId: "s1",
      messages: [
        { role: "user", content: "能够介绍一下杭州的景点吗，要网络搜索的结果" },
        { role: "assistant", content: "好的，我来搜索一下杭州的景点。" },
        { role: "user", content: "你搜索了吗" },
      ],
    };

    const Ctor = resolveElement("predict-input");
    const el = new Ctor({
      name: "predict-input",
      kind: "source",
      bus,
      session,
      task: { payload: [{ data: "你搜索了吗" }] },
    });

    const result = await el.doProcess({ mode: "initial", task: { payload: [{ data: "你搜索了吗" }] } });
    expect(result.userMessage).toBe("你搜索了吗");
    expect(result.contextMessages).toBeDefined();
    expect(result.contextMessages).toContain("能够介绍一下杭州的景点吗");
    expect(result.contextMessages).toContain("好的，我来搜索一下");
  });

  test("predict-input handles empty session for context", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("predict-input");
    const el = new Ctor({
      name: "predict-input",
      kind: "source",
      bus,
      session: { sessionId: "s1", messages: [] },
      task: { payload: [{ data: "hello" }] },
    });

    const result = await el.doProcess({ mode: "initial", task: { payload: [{ data: "hello" }] } });
    expect(result.userMessage).toBe("hello");
    expect(result.contextMessages).toBe("");
  });

  test("predict-input handles empty payload", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("predict-input");
    const el = new Ctor({
      name: "predict-input",
      kind: "source",
      bus,
      session: null,
      task: { payload: [] },
    });

    const result = await el.doProcess({ mode: "initial", task: { payload: [] } });
    expect(result.mode).toBe("predicting");
    expect(result.userMessage).toBe("");
  });

  test("predict-intent falls back when no apiKey", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("predict-intent");
    const el = new Ctor({
      name: "predict-intent",
      kind: "transform",
      bus,
      apiKey: "",
      model: "deepseek-chat",
    });

    const result = await el.doProcess({
      mode: "predicting",
      task: {},
      session: null,
      userMessage: "帮我查天气",
    });

    expect(result.mode).toBe("routing");
    expect(result.prediction).toBeDefined();
    expect(result.prediction!.toolTier).toBe("basic");
    expect(result.prediction!.difficulty).toBe("balanced");
  });

  test("predict-intent falls back on empty message", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("predict-intent");
    const el = new Ctor({
      name: "predict-intent",
      kind: "transform",
      bus,
      apiKey: "sk-test",
      model: "deepseek-chat",
    });

    const result = await el.doProcess({
      mode: "predicting",
      task: {},
      session: null,
      userMessage: "",
    });

    expect(result.mode).toBe("routing");
    expect(result.prediction!.toolTier).toBe("basic");
  });

  test("predict-finalize writes prediction to session and enqueues conversation task", async () => {
    const bus = makeBus();
    const session = { sessionId: "s1", messages: [{ role: "user", content: "hello" }] };
    const capture = { enqueued: null as any };

    const Ctor = resolveElement("predict-finalize");
    const el = new Ctor({
      name: "predict-finalize",
      kind: "sink",
      bus,
      orchestrator: makeMockOrchestrator(capture),
    });

    const result = await el.doProcess({
      mode: "routing",
      task: { id: "t1", chatId: "c1", payload: [{ type: "text", data: "hello" }] },
      session,
      userMessage: "hello",
      prediction: { toolTier: "full", difficulty: "advanced", reasoning: "needs shell" },
    });

    expect(result.type).toBe("complete");
    expect(session.pendingPrediction).toBeDefined();
    expect(session.pendingPrediction.toolTier).toBe("full");
    expect(session.pendingPrediction.difficulty).toBe("advanced");
    expect(capture.enqueued).not.toBeNull();
    expect(capture.enqueued.pipeline).toBe("conversation");
    expect(capture.enqueued.parentTaskId).toBe("t1");
  });

  test("predict-finalize uses fallback when no prediction", async () => {
    const bus = makeBus();
    const session = { sessionId: "s1" };
    const capture = { enqueued: null as any };

    const Ctor = resolveElement("predict-finalize");
    const el = new Ctor({
      name: "predict-finalize",
      kind: "sink",
      bus,
      orchestrator: makeMockOrchestrator(capture),
    });

    await el.doProcess({
      mode: "routing",
      task: { id: "t1", chatId: "c1", payload: [] },
      session,
      userMessage: "hello",
    });

    expect(session.pendingPrediction.toolTier).toBe("basic");
    expect(session.pendingPrediction.difficulty).toBe("balanced");
    expect(capture.enqueued.pipeline).toBe("conversation");
  });
});

describe("prediction pipeline DSL", () => {
  test("predictionPipeline builds without errors", () => {
    const bus = makeBus();
    const pipeline = predictionPipeline({
      session: { sessionId: "s1" },
      task: { id: "t1", payload: [{ data: "test" }] },
      apiKey: "sk-test",
      model: "deepseek-chat",
      orchestrator: makeMockOrchestrator(null),
    }).build(bus);

    expect(pipeline.name).toBe("prediction");
    expect(pipeline.elements.length).toBe(3);
    expect(pipeline.elements[0].kind).toBe("source");
    expect(pipeline.elements[1].kind).toBe("transform");
    expect(pipeline.elements[2].kind).toBe("sink");
  });
});
