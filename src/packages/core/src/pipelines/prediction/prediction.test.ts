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

  test("route-conversation calls buildConversation with prediction", async () => {
    const bus = makeBus();
    let captured: any = null;
    const session = { sessionId: "s1", messages: [{ role: "user", content: "hello" }] };

    const Ctor = resolveElement("route-conversation");
    const el = new Ctor({
      name: "route-conversation",
      kind: "sink",
      bus,
      buildConversation: (s: any, p: any) => {
        captured = { session: s, prediction: p };
      },
    });

    const result = await el.doProcess({
      mode: "routing",
      task: { id: "t1" },
      session,
      userMessage: "hello",
      prediction: { toolTier: "full", difficulty: "advanced", reasoning: "needs shell" },
    });

    expect(result.type).toBe("complete");
    expect(captured).not.toBeNull();
    expect(captured.session).toBe(session);
    expect(captured.prediction.toolTier).toBe("full");
    expect(captured.prediction.difficulty).toBe("advanced");
  });

  test("route-conversation uses fallback when no prediction", async () => {
    const bus = makeBus();
    let captured: any = null;

    const Ctor = resolveElement("route-conversation");
    const el = new Ctor({
      name: "route-conversation",
      kind: "sink",
      bus,
      buildConversation: (s: any, p: any) => {
        captured = { prediction: p };
      },
    });

    await el.doProcess({
      mode: "routing",
      task: { id: "t1" },
      session: { sessionId: "s1" },
      userMessage: "hello",
    });

    expect(captured.prediction.toolTier).toBe("basic");
    expect(captured.prediction.difficulty).toBe("balanced");
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
      buildConversation: () => {},
    }).build(bus);

    expect(pipeline.name).toBe("prediction");
    expect(pipeline.elements.length).toBe(3);
    expect(pipeline.elements[0].kind).toBe("source");
    expect(pipeline.elements[1].kind).toBe("transform");
    expect(pipeline.elements[2].kind).toBe("sink");
  });
});
