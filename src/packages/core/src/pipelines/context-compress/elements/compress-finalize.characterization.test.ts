/**
 * Behavior snapshot for CompressFinalizeElement (S12-E5).
 *
 * Locks: early completion outputs/status, context entries, checkpoint
 * arguments, rollback on checkpoint failure, and resume scheduling branches.
 */
import { describe, expect, mock, test } from "bun:test";
import { BusEvents } from "@atom-neo/shared";
import { ContextService } from "../../../context/context-service";
import { SessionContext } from "../../../session/context";
import { makeBus } from "../../test-helpers";
import { CompressFinalizeElement } from "./compress-finalize";
import type { CompressFlowState } from "./types";

type Harness = {
  element: CompressFinalizeElement;
  contextService: ContextService;
  session: SessionContext;
  events: any[];
  calls: any[];
  checkpoint: ReturnType<typeof mock>;
};

function harness(options: { checkpoint?: (session: any, reason: string, messages: readonly any[]) => void; archiveIndex?: unknown } = {}): Harness {
  const bus = makeBus();
  const events: any[] = [];
  const calls: any[] = [];
  bus.on(BusEvents.Element.Data, ({ payload }: any) => events.push(payload));
  const contextService = new ContextService(bus, { sweepIntervalMs: 0 });
  contextService.start();
  const checkpoint = mock((...args: any[]) => { options.checkpoint?.(args[0], args[1], args[2]); });
  const orchestrator = {
    releaseTask: (...args: any[]) => calls.push(["releaseTask", ...args]),
    scheduleContinuation: (...args: any[]) => calls.push(["scheduleContinuation", ...args]),
    scheduleConversation: (...args: any[]) => calls.push(["scheduleConversation", ...args]),
  };
  const session = new SessionContext("s1");
  const element = new CompressFinalizeElement({
    name: "compress-finalize", kind: "sink", bus, orchestrator: orchestrator as any, contextService,
    persistence: { getArchiveIndex: () => options.archiveIndex ?? ({ segmentCount: 1 }), checkpoint } as any,
  });
  return { element, contextService, session, events, calls, checkpoint };
}

function flow(session: SessionContext, overrides: Partial<CompressFlowState> & { archiveMessages?: any[] } = {}): any {
  const archiveMessages = overrides.archiveMessages ?? [...session.messages.slice(0, 2)];
  return { mode: "finalizing", task: { id: "t1", chatId: "c1", parentTaskId: "root" }, session,
    request: { trigger: "manual", resumeConversation: false }, archiveMessages, summaryMessages: archiveMessages,
    summaryText: "", summary: "summary", summaryMaxTokens: 400, ...overrides };
}

function seed(session: SessionContext, count = 3): void {
  for (let i = 0; i < count; i++) session.addMessage({ role: "assistant", content: `msg ${i}`, timestamp: i, visible: true });
}

describe("compress-finalize behavior snapshot", () => {
  test("archive failure stops before checkpoint", async () => {
    const { element, session, events, checkpoint } = harness();
    seed(session); session.compressing = true;
    const result = await element.doProcess(flow(session, { archiveError: "disk full" }));
    expect(result.output).toBe("compress: archive failed — disk full");
    expect(session.compressing).toBe(false);
    expect(checkpoint).not.toHaveBeenCalled();
    expect(events.map(event => [event.step, event.status])).toEqual([["finalizing", undefined], ["completed", "archive_failed"]]);
    expect(events.at(-1)).toMatchObject({ trigger: "manual", target: "context+messages", resumeConversation: false });
  });

  test("nothing to archive stops before summary and checkpoint", async () => {
    const { element, session, events, checkpoint } = harness();
    seed(session); session.compressing = true;
    const result = await element.doProcess(flow(session, { archiveMessages: [], summaryMessages: [] }));
    expect(result.output).toBe("compress: nothing to archive");
    expect(session.messages).toHaveLength(3);
    expect(session.compressing).toBe(false);
    expect(checkpoint).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ step: "completed", status: "nothing_to_archive" });
  });

  test("summary failure keeps live messages and reports the reason", async () => {
    const { element, session, events, checkpoint } = harness();
    seed(session); session.compressing = true;
    const result = await element.doProcess(flow(session, { summary: "", summaryError: "provider unavailable" }));
    expect(result.output).toBe("compress: summary failed — provider unavailable");
    expect(session.messages).toHaveLength(3);
    expect(session.compressing).toBe(false);
    expect(checkpoint).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ step: "completed", status: "summary_failed", error: "provider unavailable" });
  });

  test("empty summary uses the fixed fallback message", async () => {
    const { element, session, events } = harness();
    seed(session); session.compressing = true;
    await element.doProcess(flow(session, { summary: "" }));
    expect(events.at(-1)).toMatchObject({ step: "completed", status: "summary_failed", error: "empty summary" });
  });

  test("manual success writes context and removes archived messages", async () => {
    const { element, contextService, session, events, checkpoint } = harness();
    seed(session); session.setContextTokens(100_000);
    const archiveMessages = [...session.messages.slice(0, 2)];
    const result = await element.doProcess(flow(session, { archiveMessages, archiveReceipt: { archiveId: "message-000001", segment: 1, fromSeq: 1, toSeq: 2, count: 2 } }));
    expect(result.output).toContain("trigger=manual");
    expect(result.output).toContain("removed=2");
    expect(result.output).toContain("resumeConversation=false");
    expect(session.messages).toHaveLength(1);
    expect(contextService.get("session", { sessionId: "s1" }, "conversation-summary")?.content)
      .toEqual([{ role: "assistant", content: "[对话历史摘要]\nsummary" }]);
    expect(contextService.get("session", { sessionId: "s1" }, "history-archive-index")?.content).toEqual({ segmentCount: 1 });
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(checkpoint.mock.calls[0]?.[1]).toBe("compressed");
    expect(checkpoint.mock.calls[0]?.[2]).toHaveLength(1);
    expect(events.map(event => event.step)).toEqual(["finalizing", "checkpoint committed", "completed without conversation resume"]);
    expect(events[1]).toMatchObject({ trigger: "manual", target: "context+messages", removedMessages: 2, remainingMessages: 1,
      contextSummaryUpdated: true, contextArchiveIndexUpdated: true, summaryLen: "summary".length,
      previousContextTokens: 100_000, contextTokens: session.contextTokens, resumeConversation: false });
  });

  test("checkpoint failure rolls back entries, tokens and messages", async () => {
    const { element, contextService, session, events } = harness({ checkpoint: () => { throw new Error("disk full"); } });
    seed(session); session.setContextTokens(500); session.compressing = true;
    contextService.put({ scope: "session", owner: { sessionId: "s1" }, entry: { key: "conversation-summary", source: "old", channel: "messages", trust: "untrusted", priority: 700, content: [{ role: "assistant", content: "old" }] } });
    contextService.put({ scope: "session", owner: { sessionId: "s1" }, entry: { key: "history-archive-index", source: "old-index", channel: "runtime", trust: "trusted", priority: 500, content: { segmentCount: 9 } } });
    const result = await element.doProcess(flow(session, { summary: "new summary", archiveReceipt: { archiveId: "message-000001", segment: 1, fromSeq: 1, toSeq: 2, count: 2 } }));
    expect(result.output).toBe("compress: checkpoint failed — disk full");
    expect(session.messages).toHaveLength(3);
    expect(session.contextTokens).toBe(500);
    expect(session.compressing).toBe(false);
    expect(contextService.get("session", { sessionId: "s1" }, "conversation-summary")?.content).toEqual([{ role: "assistant", content: "old" }]);
    expect(contextService.get("session", { sessionId: "s1" }, "conversation-summary")?.source).toBe("old");
    expect(contextService.get("session", { sessionId: "s1" }, "history-archive-index")?.content).toEqual({ segmentCount: 9 });
    expect(events.at(-1)).toMatchObject({ step: "checkpoint failed", level: "warn", trigger: "manual", target: "context+messages", error: "disk full" });
  });

  test("checkpoint failure removes entries that did not exist before", async () => {
    const { element, contextService, session } = harness({ checkpoint: () => { throw new Error("disk full"); } });
    seed(session);
    await element.doProcess(flow(session, { archiveReceipt: { archiveId: "message-000001", segment: 1, fromSeq: 1, toSeq: 2, count: 2 } }));
    expect(contextService.get("session", { sessionId: "s1" }, "conversation-summary")).toBeUndefined();
    expect(contextService.get("session", { sessionId: "s1" }, "history-archive-index")).toBeUndefined();
  });

  test("resume without continuation schedules the fixed prompt", async () => {
    const { element, session, events, calls } = harness();
    seed(session);
    await element.doProcess(flow(session, { request: { trigger: "manual", resumeConversation: true } }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject(["scheduleConversation", "s1", "c1", "root", [{ type: "text", data: expect.stringContaining("从被截断处继续") }], undefined, "t1"]);
    expect(events.map(event => event.step)).toContain("conversation resume scheduled");
  });

  test("resumeTask releases the held task instead of scheduling", async () => {
    const { element, session, calls } = harness();
    seed(session);
    const resumeTask = { id: "held" } as any;
    const result = await element.doProcess(flow(session, { request: { trigger: "manual", resumeConversation: true, resumeTask } }));
    expect(calls).toEqual([["releaseTask", resumeTask, "t1"]]);
    expect(result.chainAction).toBeUndefined();
  });

  test("token-overflow continuation waits for chain governance", async () => {
    const { element, session, calls } = harness();
    seed(session);
    const continuation = { kind: "resume_current" as const, reason: "length", source: "rules" as const };
    const result = await element.doProcess(flow(session, { request: { trigger: "token-overflow", resumeConversation: true, continuation } }));
    expect(calls).toEqual([]);
    expect(result).toMatchObject({ chainAction: "follow_up", continuationDecision: continuation,
      output: "compress: saved, continuation awaiting chain governance" });
  });

  test("non-overflow continuation is scheduled with the owner task", async () => {
    const { element, session, calls } = harness();
    seed(session);
    const continuation = { kind: "resume_current" as const, reason: "length", source: "rules" as const };
    const result = await element.doProcess(flow(session, { request: { trigger: "context-pressure", resumeConversation: true, continuation } }));
    expect(calls).toEqual([["scheduleContinuation", "s1", "c1", "root", "t1", continuation]]);
    expect(result.chainAction).toBeUndefined();
  });
});
