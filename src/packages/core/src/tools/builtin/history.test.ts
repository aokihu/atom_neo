import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { ContextService } from "../../context/context-service";
import { SessionContext } from "../../session/context";
import { SessionPersistenceService } from "../../session/persistence-service";
import { createHistoryTools } from "./history";

const roots: string[] = [];

const setup = () => {
  const root = mkdtempSync(resolve(tmpdir(), "atom-history-tool-"));
  roots.push(root);
  const contextService = new ContextService(new PipelineEventBus<FullEventMap>(), { sweepIntervalMs: 0 });
  const persistence = new SessionPersistenceService(root, contextService);
  const session = new SessionContext("s1");
  session.addMessage({ role: "user", content: "the exact weather decision", timestamp: 1, visible: true });
  session.addMessage({ role: "assistant", content: "internal", timestamp: 2, visible: false });
  persistence.archiveMessages(session.sessionId, session.messages);
  const tools = createHistoryTools(persistence);
  return {
    persistence,
    session,
    search: tools.find(tool => tool.name === "search_history")!,
    read: tools.find(tool => tool.name === "read_history")!,
  };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("session history tools", () => {
  test("searches only the current session and hides internal messages", async () => {
    const { search } = setup();
    const result = await search.execute({ query: "exact" }, { sessionId: "s1" });
    const hidden = await search.execute({ query: "internal" }, { sessionId: "s1" });
    const other = await search.execute({ query: "exact" }, { sessionId: "s2" });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("message-000001");
    expect(hidden.output).toBe("No matching session history.");
    expect(other.output).toBe("No matching session history.");
  });

  test("prefers an immutable archive when latest contains the same message", async () => {
    const { persistence, session, search } = setup();
    persistence.checkpoint(session, "message");

    const result = await search.execute({ query: "exact" }, { sessionId: session.sessionId });
    expect(result.output).toContain('archiveId="message-000001"');
    expect(result.output).not.toContain('archiveId="message-latest"');
  });

  test("rejects physical paths and reads a bounded archive", async () => {
    const { read } = setup();
    const invalid = await read.execute({ archiveId: "../../session.json" }, { sessionId: "s1" });
    const result = await read.execute({ archiveId: "message-000001", limit: 1 }, { sessionId: "s1" });

    expect(invalid.ok).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("exact weather decision");
    expect(result.output).not.toContain("internal");
  });

  test("pages through a long Unicode message without losing text", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "atom-history-long-"));
    roots.push(root);
    const contextService = new ContextService(new PipelineEventBus<FullEventMap>(), { sweepIntervalMs: 0 });
    const persistence = new SessionPersistenceService(root, contextService);
    const session = new SessionContext("long");
    const original = `${"a".repeat(7_400)}😀${"b".repeat(7_400)}`;
    session.addMessage({ role: "user", content: original, timestamp: 1, visible: true });
    const archiveId = persistence.archiveMessages(session.sessionId, session.messages)!.archiveId;
    const read = createHistoryTools(persistence).find(tool => tool.name === "read_history")!;
    let offset = 0;
    let restored = "";

    for (let page = 0; page < 10; page++) {
      const result = await read.execute(
        { archiveId, fromSeq: 1, toSeq: 1, offset, limit: 1 },
        { sessionId: session.sessionId },
      );
      expect(result.ok).toBe(true);
      expect(result.output.isWellFormed()).toBe(true);
      const lines = result.output.split("\n").map(line => JSON.parse(line));
      restored += lines.find(line => line.content !== undefined)?.content ?? "";
      const cursor = lines.find(line => line.type === "history_cursor")?.next;
      if (!cursor) break;
      expect(cursor.offset).toBeGreaterThan(offset);
      offset = cursor.offset;
    }

    expect(restored).toBe(original);
  });

  test("pages through a range containing more messages than the page limit", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "atom-history-page-"));
    roots.push(root);
    const contextService = new ContextService(new PipelineEventBus<FullEventMap>(), { sweepIntervalMs: 0 });
    const persistence = new SessionPersistenceService(root, contextService);
    const session = new SessionContext("many");
    for (let seq = 1; seq <= 30; seq++) {
      session.addMessage({ role: "user", content: `message ${seq}`, timestamp: seq, visible: true });
    }
    const archiveId = persistence.archiveMessages(session.sessionId, session.messages)!.archiveId;
    const read = createHistoryTools(persistence).find(tool => tool.name === "read_history")!;
    let args = { archiveId, fromSeq: 1, toSeq: 30, offset: 0, limit: 20 };
    const restored: number[] = [];

    for (let page = 0; page < 3; page++) {
      const result = await read.execute(args, { sessionId: session.sessionId });
      expect(result.ok).toBe(true);
      const lines = result.output.split("\n").map(line => JSON.parse(line));
      restored.push(...lines.flatMap(line => line.seq === undefined ? [] : [line.seq]));
      const cursor = lines.find(line => line.type === "history_cursor")?.next;
      if (!cursor) break;
      expect(cursor.toSeq).toBe(30);
      args = cursor;
    }

    expect(restored).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
  });

  test("expires a latest cursor when its checkpoint changes", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "atom-history-latest-"));
    roots.push(root);
    const contextService = new ContextService(new PipelineEventBus<FullEventMap>(), { sweepIntervalMs: 0 });
    const persistence = new SessionPersistenceService(root, contextService);
    const session = new SessionContext("latest");
    for (let seq = 1; seq <= 30; seq++) {
      session.addMessage({ role: "user", content: `message ${seq}`, timestamp: seq, visible: true });
    }
    persistence.checkpoint(session, "message");
    const read = createHistoryTools(persistence).find(tool => tool.name === "read_history")!;
    const first = await read.execute(
      { archiveId: "message-latest", fromSeq: 1, toSeq: 30, limit: 20 },
      { sessionId: session.sessionId },
    );
    const cursor = first.output.split("\n")
      .map(line => JSON.parse(line))
      .find(line => line.type === "history_cursor")?.next;
    expect(cursor.checkpointRevision).toBe(1);

    session.addMessage({ role: "assistant", content: "changed", timestamp: 31, visible: true });
    persistence.checkpoint(session, "message");
    const second = await read.execute(cursor, { sessionId: session.sessionId });

    expect(second.ok).toBe(false);
    expect(second.error).toBe("History cursor expired");
  });

  test("binds the first latest read to the searched checkpoint and exact anchor", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "atom-history-latest-search-"));
    roots.push(root);
    const contextService = new ContextService(new PipelineEventBus<FullEventMap>(), { sweepIntervalMs: 0 });
    const persistence = new SessionPersistenceService(root, contextService);
    const session = new SessionContext("latest-search");
    for (let seq = 1; seq <= 3; seq++) {
      session.addMessage({ role: "user", content: `message ${seq}`, timestamp: seq, visible: true });
    }
    persistence.checkpoint(session, "message");
    const tools = createHistoryTools(persistence);
    const search = tools.find(tool => tool.name === "search_history")!;
    const read = tools.find(tool => tool.name === "read_history")!;

    const found = await search.execute({ query: "message 1" }, { sessionId: session.sessionId });
    expect(found.output).toContain('archiveId="message-latest"');
    expect(found.output).toContain('checkpointRevision="1"');

    persistence.archiveMessages(session.sessionId, session.messages.slice(0, 2));
    session.removeMessages([1, 2]);
    persistence.checkpoint(session, "compressed");
    const stale = await read.execute(
      { archiveId: "message-latest", fromSeq: 1, toSeq: 3 },
      { sessionId: session.sessionId },
    );

    expect(stale.ok).toBe(false);
    expect(stale.error).toBe("History cursor expired");
  });

  test("rejects missing anchors, reversed ranges, and unsafe offsets", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "atom-history-offset-"));
    roots.push(root);
    const contextService = new ContextService(new PipelineEventBus<FullEventMap>(), { sweepIntervalMs: 0 });
    const persistence = new SessionPersistenceService(root, contextService);
    const session = new SessionContext("offset");
    session.addMessage({ role: "user", content: "a😀b", timestamp: 1, visible: true });
    persistence.archiveMessages(session.sessionId, session.messages);
    const read = createHistoryTools(persistence).find(tool => tool.name === "read_history")!;

    const missing = await read.execute(
      { archiveId: "message-000001", fromSeq: 2, offset: 0 },
      { sessionId: session.sessionId },
    );
    const unanchored = await read.execute(
      { archiveId: "message-000001", offset: 1 },
      { sessionId: session.sessionId },
    );
    const reversed = await read.execute(
      { archiveId: "message-000001", fromSeq: 2, toSeq: 1 },
      { sessionId: session.sessionId },
    );
    const splitPair = await read.execute(
      { archiveId: "message-000001", fromSeq: 1, toSeq: 1, offset: 2 },
      { sessionId: session.sessionId },
    );
    const beyond = await read.execute(
      { archiveId: "message-000001", fromSeq: 1, toSeq: 1, offset: 99 },
      { sessionId: session.sessionId },
    );
    const atEnd = await read.execute(
      { archiveId: "message-000001", fromSeq: 1, toSeq: 1, offset: 4 },
      { sessionId: session.sessionId },
    );

    expect(missing.error).toBe("History cursor expired");
    expect(unanchored.error).toBe("Invalid input");
    expect(reversed.error).toBe("Invalid input");
    expect(splitPair.error).toBe("Invalid history offset");
    expect(beyond.error).toBe("Invalid history offset");
    expect(atEnd.error).toBe("Invalid history offset");
  });
});
