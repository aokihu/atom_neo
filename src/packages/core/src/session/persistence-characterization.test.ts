import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { ContextService } from "../context/context-service";
import { SessionContext } from "./context";
import { SessionPersistenceService } from "./persistence-service";

const roots: string[] = [];
const contexts: ContextService[] = [];
const GENERATION_PATTERN = /^g-\d{12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURRENT_PATTERN = /^\.checkpoints\/g-\d{12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHECKPOINT_FILES = ["context.json", "message-latest.jsonl", "session.json", "tool-records.jsonl"];

const createPersistence = (root = mkdtempSync(resolve(tmpdir(), "atom-persistence-characterization-"))) => {
  roots.push(root);
  const bus = new PipelineEventBus<FullEventMap>();
  const contextService = new ContextService(bus, { sweepIntervalMs: 0 });
  contextService.start();
  contexts.push(contextService);
  return { root, contextService, persistence: new SessionPersistenceService(root, contextService) };
};

afterEach(() => {
  for (const contextService of contexts.splice(0)) contextService.stop();
  for (const root of new Set(roots.splice(0))) rmSync(root, { recursive: true, force: true });
});

describe("persistence characterization", () => {
  test("locks checkpoint directory layout, symlinks, and persisted field sets", () => {
    const first = createPersistence();
    const session = new SessionContext("layout/unsafe id", 100, { type: "tui" });
    session.lastTuiUsedAt = 200;
    session.addMessage({ role: "user", content: "first message", timestamp: 1, visible: true });
    session.setTodoState([{ content: "persist", status: "in_progress", priority: "high" }]);
    session.setContinuationContext({ summary: "started", nextPrompt: "continue", avoidRepeat: "intro", updatedAt: 2 });
    first.contextService.put({
      scope: "session",
      owner: { sessionId: session.sessionId },
      entry: {
        key: "conversation-summary",
        source: "test",
        channel: "messages",
        trust: "untrusted",
        priority: 10,
        content: [{ role: "assistant", content: "summary" }],
      },
    });
    const group = first.persistence.toolRecords.beginGroup(session.sessionId, "task-1");
    first.persistence.toolRecords.append(group, {
      modelStep: 1,
      batchIndex: 0,
      toolCallId: "call-1",
      toolName: "weather",
      source: "mcp",
      startedAt: 3,
      durationMs: 4,
      input: { city: "Hangzhou" },
      output: { temperature: 28 },
      metadata: { ok: true, effect: "reference" },
    });
    first.persistence.toolRecords.seal(group);
    first.persistence.checkpoint(session, "message");
    session.addMessage({ role: "assistant", content: "second message", timestamp: 2, visible: true });
    first.persistence.checkpoint(session, "message");

    const dir = first.persistence.getSessionDirectory(session.sessionId, false);
    expect(basename(dir)).toBe("3aefd158727bdb5a5d12c1e7942b418c");
    expect(readdirSync(dir).toSorted()).toEqual([
      ".checkpoints",
      "context.json",
      "current",
      "message-latest.jsonl",
      "session.json",
      "tool-records.jsonl",
    ]);
    expect(lstatSync(resolve(dir, "current")).isSymbolicLink()).toBe(true);
    const currentTarget = readlinkSync(resolve(dir, "current"));
    expect(currentTarget).toMatch(CURRENT_PATTERN);
    for (const filename of CHECKPOINT_FILES) {
      expect(lstatSync(resolve(dir, filename)).isSymbolicLink()).toBe(true);
      expect(readlinkSync(resolve(dir, filename))).toBe(`current/${filename}`);
    }

    const generationDir = resolve(dir, currentTarget);
    const generationName = basename(generationDir);
    expect(generationName).toMatch(GENERATION_PATTERN);
    expect(readdirSync(generationDir).toSorted()).toEqual(CHECKPOINT_FILES);
    const generations = readdirSync(resolve(dir, ".checkpoints")).filter(name => name.startsWith("g-")).toSorted();
    expect(generations).toHaveLength(2);
    expect(generations.at(-1)).toBe(generationName);

    const state = JSON.parse(readFileSync(resolve(dir, "session.json"), "utf8"));
    expect(Object.keys(state)).toEqual([
      "initiator",
      "lastTuiUsedAt",
      "schemaVersion",
      "checkpointRevision",
      "sessionId",
      "status",
      "createdAt",
      "updatedAt",
      "closeReason",
      "currentTopic",
      "chainDepth",
      "todoState",
      "continuationContext",
      "inferenceFacts",
      "tokenUsage",
      "contextTokens",
      "nextMessageSeq",
      "archives",
    ]);
    expect(state).toMatchObject({
      initiator: { type: "tui" },
      lastTuiUsedAt: 200,
      schemaVersion: 1,
      checkpointRevision: 2,
      sessionId: session.sessionId,
      status: "active",
      createdAt: 100,
      closeReason: "message",
      currentTopic: null,
      chainDepth: 0,
      todoState: [{ content: "persist", status: "in_progress", priority: "high" }],
      continuationContext: { summary: "started", nextPrompt: "continue", avoidRepeat: "intro", updatedAt: 2 },
      inferenceFacts: [],
      tokenUsage: { total: 0 },
      contextTokens: 0,
      nextMessageSeq: 3,
      archives: { segmentCount: 0, archivedMessageCount: 0, latestMessageCount: 2, nextSegment: 1 },
    });

    const latestLines = readFileSync(resolve(dir, "message-latest.jsonl"), "utf8").trimEnd().split("\n");
    expect(latestLines).toHaveLength(3);
    const manifest = JSON.parse(latestLines[0]!);
    expect(Object.keys(manifest)).toEqual([
      "type",
      "schemaVersion",
      "archiveId",
      "checkpointRevision",
      "fromSeq",
      "toSeq",
      "count",
      "createdAt",
    ]);
    expect(manifest).toMatchObject({
      type: "manifest",
      schemaVersion: 1,
      archiveId: "message-latest",
      checkpointRevision: 2,
      fromSeq: 1,
      toSeq: 2,
      count: 2,
    });
    expect(JSON.parse(latestLines[1]!)).toMatchObject({ type: "message", seq: 1, role: "user", content: "first message" });
    expect(JSON.parse(latestLines[2]!)).toMatchObject({ type: "message", seq: 2, role: "assistant", content: "second message" });

    const context = JSON.parse(readFileSync(resolve(dir, "context.json"), "utf8"));
    expect(Object.keys(context)).toEqual(["schemaVersion", "checkpointRevision", "savedAt", "sessionId", "buckets"]);
    expect(context).toMatchObject({ schemaVersion: 1, checkpointRevision: 2, sessionId: session.sessionId });
    expect(context.buckets).toHaveLength(1);

    const toolLines = readFileSync(resolve(dir, "tool-records.jsonl"), "utf8").trimEnd().split("\n");
    expect(toolLines).toHaveLength(2);
    expect(JSON.parse(toolLines[0]!)).toEqual({
      type: "manifest",
      schemaVersion: 1,
      checkpointRevision: 2,
      count: 1,
    });
    expect(JSON.parse(toolLines[1]!)).toMatchObject({ type: "tools-group", group: { status: "sealed" } });
  });

  test("locks archive segments, index, and history query semantics", () => {
    const { persistence } = createPersistence();
    const session = new SessionContext("history", 100, { type: "tui" });
    session.addMessage({ role: "user", content: "the exact blue decision", timestamp: 1, visible: true });
    session.addMessage({ role: "assistant", content: "confirmed blue", timestamp: 2, visible: true });
    session.addMessage({ role: "user", content: "hidden blue", timestamp: 3, visible: false });

    const receipt = persistence.archiveMessages(session.sessionId, session.messages.slice(0, 2))!;
    expect(receipt).toEqual({ archiveId: "message-000001", segment: 1, fromSeq: 1, toSeq: 2, count: 2 });
    const duplicate = persistence.archiveMessages(session.sessionId, session.messages.slice(0, 2))!;
    expect(duplicate).toEqual(receipt);

    const dir = persistence.getSessionDirectory(session.sessionId, false);
    expect(readdirSync(dir).filter(name => name.startsWith("message-"))).toEqual(["message-000001.jsonl"]);
    const archiveLines = readFileSync(resolve(dir, "message-000001.jsonl"), "utf8").trimEnd().split("\n");
    expect(archiveLines).toHaveLength(3);
    expect(JSON.parse(archiveLines[0]!)).toMatchObject({
      type: "manifest",
      schemaVersion: 1,
      archiveId: "message-000001",
      segment: 1,
      fromSeq: 1,
      toSeq: 2,
      count: 2,
    });

    expect(persistence.getArchiveIndex(session.sessionId)).toEqual({
      segmentCount: 1,
      messageCount: 2,
      fromSeq: 1,
      toSeq: 2,
      latestArchiveId: "message-000001",
      retrieval: "Use search_history, then read_history, to verify original conversation messages.",
    });
    expect(persistence.searchHistory(session.sessionId, { query: "BLUE" })).toEqual([
      { archiveId: "message-000001", seq: 1, role: "user", timestamp: 1, content: "the exact blue decision" },
      { archiveId: "message-000001", seq: 2, role: "assistant", timestamp: 2, content: "confirmed blue" },
    ]);
    expect(persistence.searchHistory(session.sessionId, { query: "blue", role: "assistant" })).toHaveLength(1);
    expect(persistence.searchHistory(session.sessionId, { query: "blue", limit: 1 })).toHaveLength(1);
    expect(persistence.readHistory(session.sessionId, { archiveId: receipt.archiveId, fromSeq: 2, limit: 1 })).toEqual([
      { archiveId: "message-000001", seq: 2, role: "assistant", timestamp: 2, content: "confirmed blue" },
    ]);
    expect(() => persistence.readHistory(session.sessionId, { archiveId: "bad-id" })).toThrow("Invalid archiveId");
    expect(() => persistence.readHistory(session.sessionId, { archiveId: receipt.archiveId, fromSeq: 2, toSeq: 1 }))
      .toThrow("Invalid history range");

    persistence.checkpoint(session, "message");
    expect(persistence.getHistoryArchiveRevision(session.sessionId, "message-latest")).toBe(1);
    expect(persistence.searchHistory(session.sessionId, { query: "hidden" })).toHaveLength(0);
    expect(persistence.readHistory(session.sessionId, { archiveId: "message-latest" })).toHaveLength(2);

    persistence.remove(session.sessionId);
    expect(existsSync(dir)).toBe(false);
    expect(persistence.toolRecords.exportSession(session.sessionId)).toEqual([]);
  });

  test("locks checkpoint reason to status mapping", () => {
    const { persistence } = createPersistence();
    const cases = [
      { reason: "message" as const, status: "active" as const },
      { reason: "task_completed" as const, status: "active" as const },
      { reason: "task_failed" as const, status: "active" as const },
      { reason: "compressed" as const, status: "active" as const },
      { reason: "restore" as const, status: "interrupted" as const },
      { reason: "idle" as const, status: "suspended" as const },
      { reason: "capacity" as const, status: "suspended" as const },
      { reason: "shutdown" as const, status: "suspended" as const },
    ];
    for (const [index, entry] of cases.entries()) {
      const session = new SessionContext(`status-${index}`);
      session.addMessage({ role: "user", content: entry.reason, timestamp: 1 });
      const state = persistence.checkpoint(session, entry.reason);
      expect(state.status).toBe(entry.status);
      expect(state.closeReason).toBe(entry.reason);
      const dir = persistence.getSessionDirectory(session.sessionId, false);
      const persisted = JSON.parse(readFileSync(resolve(dir, "current/session.json"), "utf8"));
      expect(persisted.status).toBe(entry.status);
    }
  });

  test("locks listTuiSessions selection fields", () => {
    const { persistence } = createPersistence();
    const tui = new SessionContext("tui-session", 100, { type: "tui" });
    tui.lastTuiUsedAt = 42;
    persistence.checkpoint(tui, "message");
    const gateway = new SessionContext("gateway-session", 100, { type: "gateway", clientId: "bot", platform: "telegram" });
    persistence.checkpoint(gateway, "message");

    expect(persistence.listTuiSessions()).toEqual([{ sessionId: "tui-session", lastTuiUsedAt: 42 }]);
    expect(persistence.restore("tui-session")?.sessionId).toBe("tui-session");
  });
});
