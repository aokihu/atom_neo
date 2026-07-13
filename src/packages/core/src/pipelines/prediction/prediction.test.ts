import { describe, test, expect, beforeAll } from "bun:test";
import { registerPredictionElements, predictionPipeline } from "../index";
import { registerSharedElements } from "../shared";
import { resolveElement } from "../../pipeline/registry";
import { makeBus, makeMockOrchestrator } from "../test-helpers";
import { ContextService } from "../../context/context-service";
import { parseIntentPrediction } from "./elements/predict-intent";

beforeAll(() => {
  registerPredictionElements();
  registerSharedElements();
});

describe("prediction pipeline elements", () => {
  test("parses a core Memory query for information lookup", () => {
    const prediction = parseIntentPrediction({
      difficulty: "easy",
      model_profile: "basic",
      intent: "question",
      context_relevance: "standalone",
      memory_query: " 台风 ",
      topic: "knowledge.weather.typhoon",
      reasoning: "current information lookup",
    });

    expect(prediction.intent).toBe("question");
    expect(prediction.memoryQuery).toBe("台风");
  });

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
      model: "deepseek-v4-flash",
    });

    const result = await el.doProcess({
      mode: "predicting",
      task: {},
      session: null,
      userMessage: "帮我查天气",
    });

    expect(result.mode).toBe("routing");
    expect(result.prediction).toBeDefined();
    expect(result.prediction!.difficulty).toBe("medium");
    expect(result.prediction!.memoryQuery).toBe("");
  });

  test("predict-intent falls back on empty message", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("predict-intent");
    const el = new Ctor({
      name: "predict-intent",
      kind: "transform",
      bus,
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
    });

    const result = await el.doProcess({
      mode: "predicting",
      task: {},
      session: null,
      userMessage: "",
    });

    expect(result.mode).toBe("routing");
    expect(result.prediction!.difficulty).toBe("medium");
  });

  test("predict-finalize writes prediction to session and enqueues conversation task", async () => {
    const bus = makeBus();
    const session = { sessionId: "s1", messages: [{ role: "user", content: "hello" }], currentTopic: null, resetForNewTopic: () => {} };
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
      prediction: { difficulty: "mygod", modelProfile: "advanced", intent: "instruction", contextRelevance: "standalone", memoryQuery: "", topic: "code.test", reasoning: "needs shell" },
    });

    expect(result.type).toBe("complete");
    expect(session.pendingPrediction).toBeDefined();
    expect(session.pendingPrediction.difficulty).toBe("mygod");
    expect(session.pendingPrediction.modelProfile).toBe("advanced");
    expect(capture.enqueued).not.toBeNull();
    expect(capture.enqueued.pipeline).toBe("conversation");
    expect(capture.enqueued.parentTaskId).toBe("t1");
  });

  test("predict-finalize uses fallback when no prediction", async () => {
    const bus = makeBus();
    const session = { sessionId: "s1", currentTopic: null, resetForNewTopic: () => {} };
    const capture = { enqueued: null as any };

    const Ctor = resolveElement("predict-finalize");
    const el = new Ctor({
      name: "predict-finalize",
      kind: "sink",
      bus,
      orchestrator: makeMockOrchestrator(capture),
    });

    await (el as any).doProcess({
      mode: "routing",
      task: { id: "t1", chatId: "c1", payload: [] },
      session,
      userMessage: "hello",
    });

    expect(session.pendingPrediction.difficulty).toBe("medium");
    expect(capture.enqueued.pipeline).toBe("conversation");
  });

  test("predict-finalize clears topic skill context when the topic changes", async () => {
    const session = { sessionId: "s1", currentTopic: "old", resetForNewTopic: (topic: string) => { session.currentTopic = topic; } };
    const cleared: string[] = [];
    const bus = makeBus();
    const contextService = new ContextService(bus, { sweepIntervalMs: 0 });
    contextService.start();
    contextService.put({
      scope: "topic",
      owner: { sessionId: "s1", topicId: "old" },
      entry: {
        key: "old-topic",
        source: "test",
        channel: "instructions",
        trust: "trusted",
        priority: 1,
        content: "old",
      },
    });
    const Ctor = resolveElement("predict-finalize");
    const el = new Ctor({
      name: "predict-finalize",
      kind: "sink",
      bus,
      orchestrator: makeMockOrchestrator(null),
      skillService: { clearScope: (sessionId: string) => cleared.push(sessionId) },
    });

    await (el as any).doProcess({
      mode: "routing",
      task: { id: "t1", chatId: "c1" },
      session,
      userMessage: "new task",
      prediction: { difficulty: "easy", modelProfile: "fast", intent: "conversation", contextRelevance: "standalone", memoryQuery: "", topic: "new", reasoning: "changed" },
    });

    expect(cleared).toEqual(["s1"]);
    expect(contextService.bucketCount).toBe(0);
  });
});

describe("prediction pipeline DSL", () => {
  test("predictionPipeline builds without errors", () => {
    const bus = makeBus();
    const pipeline = predictionPipeline({
      session: { sessionId: "s1" },
      task: { id: "t1", payload: [{ data: "test" }] },
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      orchestrator: makeMockOrchestrator(null),
    }).build(bus);

    expect(pipeline.name).toBe("prediction");
    expect(pipeline.elements.length).toBe(4);
    expect(pipeline.elements[0].kind).toBe("source");
    expect(pipeline.elements[1].kind).toBe("transform");
    expect(pipeline.elements[2].kind).toBe("boundary");
    expect(pipeline.elements[3].kind).toBe("sink");
  });
});
