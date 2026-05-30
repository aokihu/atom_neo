import { describe, test, expect, beforeAll } from "bun:test";
import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { registerContextCompressElements, contextCompressPipeline } from "../index";
import { resolveElement } from "../../pipeline/registry";

beforeAll(() => {
  registerContextCompressElements();
});

function makeBus() {
  return new PipelineEventBus<FullEventMap>();
}

function makeMockOrchestrator(capture: { enqueued: any } | null) {
  return {
    scheduleConversation: (sid: string, cid: string, ptid: string, payload?: any[], onEnqueue?: any) => {
      if (capture) capture.enqueued = { pipeline: "conversation", parentTaskId: ptid };
    },
    scheduleEvaluator: () => {},
    scheduleCompress: () => {},
    scheduleFollowUp: () => {},
  };
}

describe("compress-input", () => {
  test("extracts early messages, keeps last 20", async () => {
    const bus = makeBus();
    const session = {
      messages: Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
        timestamp: Date.now() + i,
      })),
    };

    const Ctor = resolveElement("compress-input");
    const el = new Ctor({ name: "compress-input", kind: "source", bus, session });
    const result = await el.doProcess({ mode: "initial", task: { id: "t1" } });

    expect(result.mode).toBe("summarizing");
    expect(result.archiveMessages.length).toBe(10);  // 30 messages, keep 20 → compress 10
    expect(result.summaryText).toContain("message 0");
    expect(result.summaryText).toContain("message 9");
  });

  test("handles less than 20 messages", async () => {
    const bus = makeBus();
    const session = {
      messages: [
        { role: "user", content: "hi", timestamp: Date.now() },
      ],
    };

    const Ctor = resolveElement("compress-input");
    const el = new Ctor({ name: "compress-input", kind: "source", bus, session });
    const result = await el.doProcess({ mode: "initial", task: { id: "t1" } });

    expect(result.archiveMessages.length).toBe(0);
  });
});

describe("compress-summarize", () => {
  test("falls back on empty apiKey", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("compress-summarize");
    const el = new Ctor({ name: "compress-summarize", kind: "transform", bus, apiKey: "", model: "test" });
    const result = await el.doProcess({
      mode: "summarizing", task: {}, session: null,
      archiveMessages: [], summaryText: "hello",
    });
    expect(result.mode).toBe("finalizing");
    expect(result.summary).toBe("");
  });

  test("falls back on empty text", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("compress-summarize");
    const el = new Ctor({ name: "compress-summarize", kind: "transform", bus, apiKey: "sk-test", model: "test" });
    const result = await el.doProcess({
      mode: "summarizing", task: {}, session: null,
      archiveMessages: [], summaryText: "",
    });
    expect(result.mode).toBe("finalizing");
  });
});

describe("compress-finalize", () => {
  test("writes summary and schedules conversation", async () => {
    const bus = makeBus();
    const capture = { enqueued: null as any };
    const session = {
      sessionId: "s1",
      messages: Array.from({ length: 30 }, (_, i) => ({
        role: "assistant" as const, content: `msg ${i}`, timestamp: Date.now(),
      })),
      replaceEarlyMessages: (keep: number) => {
        session.messages = session.messages.slice(-keep);
      },
    };

    const Ctor = resolveElement("compress-finalize");
    const el = new Ctor({
      name: "compress-finalize", kind: "sink", bus,
      orchestrator: makeMockOrchestrator(capture),
      sandbox: "/tmp/atom-test",
    });

    await el.doProcess({
      mode: "finalizing", task: { id: "t1", chatId: "c1", parentTaskId: "root" },
      session, archiveMessages: [], summaryText: "",
      summary: "test summary",
    });

    expect(session.conversationSummary).toContain("test summary");
    expect(session.messages.length).toBe(20);
    expect(capture.enqueued).not.toBeNull();
  });
});

describe("context-compress DSL", () => {
  test("contextCompressPipeline builds", () => {
    const bus = makeBus();
    const pipeline = contextCompressPipeline({
      session: { sessionId: "s1" },
      task: { id: "t1" },
      apiKey: "sk-test",
      model: "test",
      orchestrator: makeMockOrchestrator(null),
      sandbox: "/tmp/test",
      logger: null,
    }).build(bus);

    expect(pipeline.name).toBe("context-compress");
    expect(pipeline.elements.length).toBe(3);
  });
});
