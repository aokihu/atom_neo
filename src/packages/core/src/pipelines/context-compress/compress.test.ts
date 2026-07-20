import { describe, test, expect, beforeAll, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { registerContextCompressElements, contextCompressPipeline } from "../index";
import { registerSharedElements } from "../shared";
import { resolveElement } from "../../pipeline/registry";
import { makeBus, makeMockOrchestrator } from "../test-helpers";
import { ContextService } from "../../context/context-service";
import { SessionContext } from "../../session/context";
import { SessionPersistenceService } from "../../session/persistence-service";
import { BusEvents } from "@atom-neo/shared";

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
    const contextService = makeContextService(bus);
    const el = new Ctor({ name: "compress-input", kind: "source", bus, session, contextService });
    const result = await (el as any).doProcess({ mode: "initial", task: { id: "t1" } });

    expect(result.mode).toBe("archiving");
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
    const contextService = makeContextService(bus);
    const el = new Ctor({ name: "compress-input", kind: "source", bus, session, contextService });
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
    const contextService = makeContextService(bus);
    const el = new Ctor({ name: "compress-input", kind: "source", bus, session, contextService });
    const result = await (el as any).doProcess({ mode: "initial", task: { id: "t1" } });

    expect(result.archiveMessages.length).toBe(0);
  });
});

describe("compress-summarize", () => {
  test("falls back on empty apiKey", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("compress-summarize");
    const el = new Ctor({ name: "compress-summarize", kind: "transform", bus, apiKey: "", model: "test" });
    const result = await (el as any).doProcess({
      mode: "summarizing", task: {}, session: null,
      request: { trigger: "manual", resumeConversation: false },
      archiveMessages: [], summaryMessages: [], summaryText: "hello",
    });
    expect(result.mode).toBe("finalizing");
    expect(result.summary).toBe("");
  });

  test("falls back on empty text", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("compress-summarize");
    const el = new Ctor({ name: "compress-summarize", kind: "transform", bus, apiKey: "sk-test", model: "test" });
    const result = await (el as any).doProcess({
      mode: "summarizing", task: {}, session: null,
      request: { trigger: "manual", resumeConversation: false },
      archiveMessages: [], summaryMessages: [], summaryText: "",
    });
    expect(result.mode).toBe("finalizing");
  });
});

describe("compress-archive", () => {
  test("archives the selected prefix", async () => {
    const bus = makeBus();
    const events: Array<Record<string, unknown>> = [];
    bus.on(BusEvents.Element.Data, event => events.push(event.payload));
    const archiveMessages = [{ role: "user", content: "raw", timestamp: 1, seq: 1 }];
    const archiveMessagesFn = mock(() => ({ archiveId: "message-000001", segment: 1, fromSeq: 1, toSeq: 1, count: 1 }));
    const Ctor = resolveElement("compress-archive");
    const el = new Ctor({
      name: "compress-archive",
      kind: "transform",
      bus,
      persistence: { archiveMessages: archiveMessagesFn },
    });

    const result = await (el as any).doProcess({
      mode: "archiving",
      task: {},
      session: { sessionId: "s1" },
      request: { trigger: "manual", resumeConversation: false },
      archiveMessages,
      summaryMessages: archiveMessages,
      summaryText: "raw",
      summaryMaxTokens: 400,
    });

    expect(result.mode).toBe("summarizing");
    expect(result.archiveReceipt.archiveId).toBe("message-000001");
    expect(events.some(event => event.step === "archived" && event.count === 1)).toBe(true);
  });

  test("passes through a state that is not ready for archiving", async () => {
    const bus = makeBus();
    const archiveMessages = mock(() => null);
    const Ctor = resolveElement("compress-archive");
    const el = new Ctor({
      name: "compress-archive",
      kind: "transform",
      bus,
      persistence: { archiveMessages },
    });
    const input = { mode: "summarizing", archiveMessages: [] };

    expect(await (el as any).doProcess(input)).toBe(input);
    expect(archiveMessages).not.toHaveBeenCalled();
  });

  test("keeps the failure in flow state", async () => {
    const bus = makeBus();
    const Ctor = resolveElement("compress-archive");
    const el = new Ctor({
      name: "compress-archive",
      kind: "transform",
      bus,
      persistence: { archiveMessages: () => { throw new Error("disk full"); } },
    });
    const result = await (el as any).doProcess({
      mode: "archiving",
      task: {},
      session: { sessionId: "s1" },
      request: { trigger: "manual", resumeConversation: false },
      archiveMessages: [{ role: "user", content: "raw", timestamp: 1, seq: 1 }],
      summaryMessages: [],
      summaryText: "",
      summaryMaxTokens: 400,
    });

    expect(result.mode).toBe("finalizing");
    expect(result.archiveError).toBe("disk full");
  });
});

describe("compress-finalize", () => {
  test("writes summary and resumes an interrupted conversation", async () => {
    const bus = makeBus();
    const contextService = makeContextService(bus);
    const capture = { enqueued: null as any };
    const root = mkdtempSync(resolve(tmpdir(), "atom-compress-"));
    const persistence = new SessionPersistenceService(root, contextService);
    const session = new SessionContext("s1");
    for (let i = 0; i < 30; i++) {
      session.addMessage({ role: "assistant", content: `msg ${i}`, timestamp: Date.now(), visible: true });
    }
    const archiveMessages = [...session.messages.slice(0, 25)];
    const archiveReceipt = persistence.archiveMessages("s1", archiveMessages)!;

    const Ctor = resolveElement("compress-finalize");
    const el = new Ctor({
      name: "compress-finalize", kind: "sink", bus,
      orchestrator: makeMockOrchestrator(capture) as any,
      contextService,
      persistence,
    });

    await (el as any).doProcess({
      mode: "finalizing", task: { id: "t1", chatId: "c1", parentTaskId: "root" },
      request: { trigger: "token-overflow", resumeConversation: true },
      session, archiveMessages, summaryMessages: archiveMessages, archiveReceipt, summaryText: "",
      summary: "test summary",
      keepCount: 5,
      summaryMaxTokens: 400,
    });

    expect(contextService.get("session", { sessionId: "s1" }, "conversation-summary")?.content)
      .toEqual([{ role: "assistant", content: "[对话历史摘要]\ntest summary" }]);
    expect(session.messages.length).toBe(5);
    expect(capture.enqueued).not.toBeNull();
    expect(capture.enqueued.payload[0]?.data).toContain("从被截断处继续");
    rmSync(root, { recursive: true, force: true });
  });

  test("manual compact commits context and messages without starting conversation", async () => {
    const bus = makeBus();
    const events: Array<Record<string, unknown>> = [];
    bus.on(BusEvents.Element.Data, event => events.push(event.payload));
    const contextService = makeContextService(bus);
    const capture = { enqueued: null as any };
    const root = mkdtempSync(resolve(tmpdir(), "atom-compress-"));
    const persistence = new SessionPersistenceService(root, contextService);
    const session = new SessionContext("s1");
    session.setContextTokens(100_000);
    for (let i = 0; i < 3; i++) {
      session.addMessage({ role: "assistant", content: `msg ${i}`, timestamp: i, visible: true });
    }
    const archiveMessages = [...session.messages.slice(0, 2)];
    const archiveReceipt = persistence.archiveMessages("s1", archiveMessages)!;
    const Ctor = resolveElement("compress-finalize");
    const el = new Ctor({
      name: "compress-finalize", kind: "sink", bus,
      orchestrator: makeMockOrchestrator(capture) as any,
      contextService,
      persistence,
    });

    const result = await (el as any).doProcess({
      mode: "finalizing",
      task: { id: "t1", chatId: "c1", parentTaskId: "manual" },
      request: { trigger: "manual", resumeConversation: false },
      session,
      archiveMessages,
      summaryMessages: archiveMessages,
      archiveReceipt,
      summaryText: "",
      summary: "manual summary",
      summaryMaxTokens: 400,
    });

    expect(session.messages).toHaveLength(1);
    expect(session.contextTokens).toBeLessThan(100_000);
    expect(capture.enqueued).toBeNull();
    expect(result.output).toContain("trigger=manual");
    expect(result.output).toContain("resumeConversation=false");
    expect(events).toContainEqual(expect.objectContaining({
      step: "checkpoint committed",
      trigger: "manual",
      target: "context+messages",
      removedMessages: 2,
      remainingMessages: 1,
      previousContextTokens: 100_000,
      contextTokens: session.contextTokens,
      resumeConversation: false,
    }));
    expect(events).toContainEqual(expect.objectContaining({
      step: "completed without conversation resume",
      trigger: "manual",
      target: "context+messages",
      resumeConversation: false,
    }));
    expect(persistence.restore("s1")?.contextTokens).toBe(session.contextTokens);
    rmSync(root, { recursive: true, force: true });
  });

  test("keeps every live message when checkpoint fails", async () => {
    const bus = makeBus();
    const contextService = makeContextService(bus);
    const capture = { enqueued: null as any };
    const session = new SessionContext("s1");
    session.setContextTokens(500);
    for (let i = 0; i < 3; i++) {
      session.addMessage({ role: "assistant", content: `msg ${i}`, timestamp: i, visible: true });
    }
    const archiveMessages = [...session.messages.slice(0, 2)];
    const Ctor = resolveElement("compress-finalize");
    const el = new Ctor({
      name: "compress-finalize",
      kind: "sink",
      bus,
      orchestrator: makeMockOrchestrator(capture) as any,
      contextService,
      persistence: {
        getArchiveIndex: () => ({ segmentCount: 1 }),
        checkpoint: () => { throw new Error("disk full"); },
      } as any,
    });

    await (el as any).doProcess({
      mode: "finalizing",
      task: { id: "t1", chatId: "c1" },
      request: { trigger: "manual", resumeConversation: false },
      session,
      archiveMessages,
      summaryMessages: archiveMessages,
      archiveReceipt: { archiveId: "message-000001", segment: 1, fromSeq: 1, toSeq: 2, count: 2 },
      summaryText: "",
      summary: "new summary",
      summaryMaxTokens: 400,
    });

    expect(session.messages).toHaveLength(3);
    expect(session.contextTokens).toBe(500);
    expect(contextService.get("session", { sessionId: "s1" }, "conversation-summary")).toBeUndefined();
    expect(capture.enqueued).toBeNull();
  });

  test("does not commit or retry when there is nothing to archive", async () => {
    const bus = makeBus();
    const capture = { enqueued: null as any };
    const checkpoint = mock(() => {});
    const session = new SessionContext("s1");
    session.compressing = true;
    const Ctor = resolveElement("compress-finalize");
    const el = new Ctor({
      name: "compress-finalize",
      kind: "sink",
      bus,
      orchestrator: makeMockOrchestrator(capture) as any,
      contextService: makeContextService(bus),
      persistence: { checkpoint, getArchiveIndex: () => ({}) } as any,
    });

    const result = await (el as any).doProcess({
      mode: "finalizing",
      task: { id: "t1" },
      request: { trigger: "manual", resumeConversation: false },
      session,
      archiveMessages: [],
      summaryMessages: [],
      summaryText: "",
      summary: "",
      summaryMaxTokens: 400,
    });

    expect(result.output).toBe("compress: nothing to archive");
    expect(checkpoint).not.toHaveBeenCalled();
    expect(capture.enqueued).toBeNull();
    expect(session.compressing).toBe(false);
  });

  test("keeps live messages when summary generation fails", async () => {
    const bus = makeBus();
    const capture = { enqueued: null as any };
    const checkpoint = mock(() => {});
    const session = new SessionContext("s1");
    session.addMessage({ role: "user", content: "important", timestamp: 1 });
    session.compressing = true;
    const archiveMessages = [...session.messages];
    const Ctor = resolveElement("compress-finalize");
    const el = new Ctor({
      name: "compress-finalize",
      kind: "sink",
      bus,
      orchestrator: makeMockOrchestrator(capture) as any,
      contextService: makeContextService(bus),
      persistence: { checkpoint, getArchiveIndex: () => ({}) } as any,
    });

    await (el as any).doProcess({
      mode: "finalizing",
      task: { id: "t1" },
      request: { trigger: "manual", resumeConversation: false },
      session,
      archiveMessages,
      summaryMessages: archiveMessages,
      archiveReceipt: { archiveId: "message-000001", segment: 1, fromSeq: 1, toSeq: 1, count: 1 },
      summaryText: "important",
      summary: "",
      summaryError: "provider unavailable",
      summaryMaxTokens: 400,
    });

    expect(session.messages).toHaveLength(1);
    expect(checkpoint).not.toHaveBeenCalled();
    expect(capture.enqueued).toBeNull();
    expect(session.compressing).toBe(false);
  });
});

describe("context-compress DSL", () => {
  test("contextCompressPipeline builds", () => {
    const bus = makeBus();
    const contextService = makeContextService(bus);
    const root = mkdtempSync(resolve(tmpdir(), "atom-compress-dsl-"));
    const persistence = new SessionPersistenceService(root, contextService);
    const pipeline = contextCompressPipeline({
      session: { sessionId: "s1" },
      task: { id: "t1" },
      apiKey: "sk-test",
      model: "test",
      orchestrator: makeMockOrchestrator(null) as any,
      sandbox: "/tmp/test",
      contextService,
      persistence,
    }).build(bus);

    expect(pipeline.name).toBe("context-compress");
    expect(pipeline.elements.length).toBe(5);
    rmSync(root, { recursive: true, force: true });
  });
});
