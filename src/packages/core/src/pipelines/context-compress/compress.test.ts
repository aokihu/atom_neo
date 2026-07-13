import { describe, test, expect, beforeAll } from "bun:test";
import { registerContextCompressElements, contextCompressPipeline } from "../index";
import { registerSharedElements } from "../shared";
import { resolveElement } from "../../pipeline/registry";
import { makeBus, makeMockOrchestrator } from "../test-helpers";
import { ContextService } from "../../context/context-service";

function makeContextService(bus: ReturnType<typeof makeBus>) {
  const service = new ContextService(bus, { sweepIntervalMs: 0 });
  service.start();
  return service;
}

beforeAll(() => {
  registerContextCompressElements();
  registerSharedElements();
});

describe("compress-input", () => {
  test("extracts early messages with the resolved keep count", async () => {
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
    expect(result.archiveMessages.length).toBe(20);  // 30 messages, strategy keeps 10 → compress 20
    expect(result.keepCount).toBe(10);
    expect(result.summaryText).toContain("message 0");
    expect(result.summaryText).toContain("message 9");
  });

  test("does not truncate live session messages before commit", async () => {
    const bus = makeBus();
    const longContent = "x".repeat(2500);
    const session = {
      compressRatio: 0.1,
      messages: [{ role: "user", content: longContent, timestamp: Date.now() }],
    };

    const Ctor = resolveElement("compress-input");
    const el = new Ctor({ name: "compress-input", kind: "source", bus, session });
    await (el as any).doProcess({ mode: "initial", task: { id: "t1" } });

    expect(session.messages[0]?.content).toBe(longContent);
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
    const contextService = makeContextService(bus);
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
      contextService,
    });

    await el.doProcess({
      mode: "finalizing", task: { id: "t1", chatId: "c1", parentTaskId: "root" },
      session, archiveMessages: [], summaryText: "",
      summary: "test summary",
      keepCount: 5,
    });

    expect(contextService.get("session", { sessionId: "s1" }, "conversation-summary")?.content)
      .toEqual([{ role: "assistant", content: "[对话历史摘要]\ntest summary" }]);
    expect(session.messages.length).toBe(5);
    expect(capture.enqueued).not.toBeNull();
  });
});

describe("context-compress DSL", () => {
  test("contextCompressPipeline builds", () => {
    const bus = makeBus();
    const contextService = makeContextService(bus);
    const pipeline = contextCompressPipeline({
      session: { sessionId: "s1" },
      task: { id: "t1" },
      apiKey: "sk-test",
      model: "test",
      orchestrator: makeMockOrchestrator(null),
      sandbox: "/tmp/test",
      contextService,
    }).build(bus);

    expect(pipeline.name).toBe("context-compress");
    expect(pipeline.elements.length).toBe(4);
  });
});
