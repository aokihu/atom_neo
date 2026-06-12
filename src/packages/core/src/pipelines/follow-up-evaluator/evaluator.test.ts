import { describe, test, expect, beforeAll } from "bun:test";
import { registerFollowUpEvaluatorElements, followUpEvaluatorPipeline } from "../index";
import { registerSharedElements } from "../shared";
import { resolveElement } from "../../pipeline/registry";
import { makeBus, makeMockOrchestrator } from "../test-helpers";

beforeAll(() => {
  registerFollowUpEvaluatorElements();
  registerSharedElements();
});

describe("evaluator-input", () => {
  test("generates summary from session messages", async () => {
    const bus = makeBus();
    const session = {
      sessionId: "s1",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ],
    };

    const Ctor = resolveElement("evaluator-input");
    const el = new Ctor({
      name: "evaluator-input", kind: "source", bus, session,
    });

    const result = await el.doProcess({ mode: "initial", task: { id: "t1" } });
    expect(result.mode).toBe("analyzing");
    expect(result.recentSummary).toContain("user: hello");
    expect(result.recentSummary).toContain("assistant: hi there");
  });

  test("handles empty session", async () => {
    const bus = makeBus();
    const session = { sessionId: "s1", messages: [] };

    const Ctor = resolveElement("evaluator-input");
    const el = new Ctor({
      name: "evaluator-input", kind: "source", bus, session,
    });

    const result = await el.doProcess({ mode: "initial", task: { id: "t1" } });
    expect(result.mode).toBe("analyzing");
    expect(result.recentSummary).toBe("");
  });
});

describe("evaluator-analyze", () => {
  test("falls back when no apiKey", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("evaluator-analyze");
    const el = new Ctor({
      name: "evaluator-analyze", kind: "transform", bus,
      apiKey: "", model: "deepseek-v4-flash",
    });

    const result = await el.doProcess({
      mode: "analyzing", task: { id: "t1" }, session: null,
      recentSummary: "user: hello\nassistant: hi",
    });

    expect(result.mode).toBe("intervening");
    expect(result.evaluation!.health).toBe("healthy");
    expect(result.evaluation!.suggestion).toBe("");
  });

  test("falls back on empty summary", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("evaluator-analyze");
    const el = new Ctor({
      name: "evaluator-analyze", kind: "transform", bus,
      apiKey: "sk-test", model: "deepseek-v4-flash",
    });

    const result = await el.doProcess({
      mode: "analyzing", task: { id: "t1" }, session: null,
      recentSummary: "",
    });

    expect(result.evaluation!.health).toBe("healthy");
  });
});

describe("evaluate-finalize", () => {
  test("healthy creates conversation task", async () => {
    const bus = makeBus();
    const capture = { enqueued: null as any };
    const session = { sessionId: "s1", addMessage: () => {} };

    const Ctor = resolveElement("evaluate-finalize");
    const el = new Ctor({
      name: "evaluate-finalize", kind: "sink", bus,
      orchestrator: makeMockOrchestrator(capture),
    });

    await el.doProcess({
      mode: "intervening", task: { id: "t1", chatId: "c1", parentTaskId: "root" },
      session, recentSummary: "",
      evaluation: { health: "healthy", suggestion: "", upgradeModel: false, reason: "" },
    });

    expect(capture.enqueued.pipeline).toBe("conversation");
    expect(capture.enqueued.parentTaskId).toBe("root");
  });

  test("looping writes suggestion and creates task", async () => {
    const bus = makeBus();
    const capture = { enqueued: null as any };
    const session = { sessionId: "s1", addMessage: () => {} };

    const Ctor = resolveElement("evaluate-finalize");
    const el = new Ctor({
      name: "evaluate-finalize", kind: "sink", bus,
      orchestrator: makeMockOrchestrator(capture),
    });

    await el.doProcess({
      mode: "intervening", task: { id: "t1", chatId: "c1", parentTaskId: "root" },
      session, recentSummary: "",
      evaluation: { health: "looping", suggestion: "try differently", upgradeModel: false, reason: "repeating" },
    });

    expect(session.evaluatorSuggestion).toBe("try differently");
    expect(capture.enqueued.pipeline).toBe("conversation");
  });

  test("stuck does not create task, appends termination message", async () => {
    const bus = makeBus();
    const capture = { enqueued: null as any };
    let addedMsg: any = null;
    const session = {
      sessionId: "s1",
      addMessage: (m: any) => { addedMsg = m; },
    };

    const Ctor = resolveElement("evaluate-finalize");
    const el = new Ctor({
      name: "evaluate-finalize", kind: "sink", bus,
      orchestrator: makeMockOrchestrator(capture),
    });

    await el.doProcess({
      mode: "intervening", task: { id: "t1", chatId: "c1", parentTaskId: "root" },
      session, recentSummary: "",
      evaluation: { health: "stuck", suggestion: "", upgradeModel: false, reason: "dead end" },
    });

    expect(capture.enqueued).toBeNull();
    expect(addedMsg).not.toBeNull();
    expect(addedMsg.content).toContain("已自动中断");
    expect(addedMsg.visible).toBe(true);
  });

  test("uses fallback when no evaluation", async () => {
    const bus = makeBus();
    const capture = { enqueued: null as any };
    const session = { sessionId: "s1", addMessage: () => {} };

    const Ctor = resolveElement("evaluate-finalize");
    const el = new Ctor({
      name: "evaluate-finalize", kind: "sink", bus,
      orchestrator: makeMockOrchestrator(capture),
    });

    await el.doProcess({
      mode: "intervening", task: { id: "t1", chatId: "c1", parentTaskId: "root" },
      session, recentSummary: "",
    });

    expect(capture.enqueued.pipeline).toBe("conversation");
  });
});

describe("follow-up-evaluator pipeline DSL", () => {
  test("followUpEvaluatorPipeline builds without errors", () => {
    const bus = makeBus();
    const pipeline = followUpEvaluatorPipeline({
      session: { sessionId: "s1" },
      task: { id: "t1" },
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      orchestrator: makeMockOrchestrator(null),
    }).build(bus);

    expect(pipeline.name).toBe("follow-up-evaluator");
    expect(pipeline.elements.length).toBe(4);
    expect(pipeline.elements[0].kind).toBe("source");
    expect(pipeline.elements[1].kind).toBe("transform");
    expect(pipeline.elements[2].kind).toBe("boundary");
    expect(pipeline.elements[3].kind).toBe("sink");
  });
});
