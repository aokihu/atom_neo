import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { decode } from "@toon-format/toon";
import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { ContextService } from "../context/context-service";
import { SessionContext } from "./context";
import { SessionPersistenceService } from "./persistence-service";

const roots: string[] = [];

const createPersistence = (root = mkdtempSync(resolve(tmpdir(), "atom-session-"))) => {
  roots.push(root);
  const bus = new PipelineEventBus<FullEventMap>();
  const contextService = new ContextService(bus, { sweepIntervalMs: 0 });
  contextService.start();
  return { root, contextService, persistence: new SessionPersistenceService(root, contextService) };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SessionPersistenceService", () => {
  test("checkpoints and restores session, context, and latest messages", () => {
    const first = createPersistence();
    const session = new SessionContext("session/unsafe");
    session.addMessage({ role: "user", content: "design context persistence", timestamp: 1 });
    session.setTodoState([{ content: "persist session", status: "in_progress", priority: "high" }]);
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

    first.persistence.checkpoint(session, "task_completed");

    const dir = first.persistence.getSessionDirectory(session.sessionId, false);
    expect(basename(dir)).not.toContain("unsafe");
    expect(readdirSync(dir).toSorted()).toEqual([
      ".checkpoints",
      "context.json",
      "current",
      "message-latest.jsonl",
      "session.json",
    ]);
    expect(lstatSync(resolve(dir, "current")).isSymbolicLink()).toBe(true);
    expect(lstatSync(resolve(dir, "session.json")).isSymbolicLink()).toBe(true);

    const second = createPersistence(first.root);
    const restored = second.persistence.restore(session.sessionId)!;
    expect(restored.messages.map(message => message.content)).toEqual(["design context persistence"]);
    expect(restored.todoState[0]?.content).toBe("persist session");
    expect(restored.continuationContext?.nextPrompt).toBe("continue");

    const snapshot = second.contextService.createSnapshot({ sessionId: session.sessionId });
    const rows = (decode(snapshot.content) as { context: Array<{ content: string }> }).context;
    expect(rows.some(row => row.content.includes("summary"))).toBe(true);
    const restoredState = JSON.parse(readFileSync(resolve(dir, "session.json"), "utf8"));
    expect(restoredState.status).toBe("interrupted");
  });

  test("archives immutable segments and queries only the requested session", () => {
    const { persistence } = createPersistence();
    const first = new SessionContext("first");
    first.addMessage({ role: "user", content: "the exact blue decision", timestamp: 1, visible: true });
    first.addMessage({ role: "assistant", content: "confirmed", timestamp: 2, visible: true });
    const receipt = persistence.archiveMessages(first.sessionId, first.messages)!;

    const second = new SessionContext("second");
    second.addMessage({ role: "user", content: "the exact red decision", timestamp: 3, visible: true });
    persistence.archiveMessages(second.sessionId, second.messages);

    expect(receipt.archiveId).toBe("message-000001");
    expect(persistence.searchHistory("first", { query: "exact" })).toHaveLength(1);
    expect(persistence.searchHistory("first", { query: "red" })).toHaveLength(0);
    expect(persistence.readHistory("first", { archiveId: receipt.archiveId })).toHaveLength(2);

    const archivePath = resolve(persistence.getSessionDirectory("first", false), `${receipt.archiveId}.jsonl`);
    const archive = readFileSync(archivePath, "utf8");
    expect(archive).toContain('"type":"manifest"');
    expect(archive).toContain('"seq":1');
  });

  test("restores only the unarchived latest tail", () => {
    const first = createPersistence();
    const session = new SessionContext("tail");
    for (let i = 1; i <= 4; i++) {
      session.addMessage({ role: i % 2 ? "user" : "assistant", content: `message ${i}`, timestamp: i });
    }
    const archived = session.messages.slice(0, 2);
    first.persistence.archiveMessages(session.sessionId, archived);
    first.persistence.checkpoint(session, "compressed", session.messages.slice(2));

    const second = createPersistence(first.root);
    const restored = second.persistence.restore(session.sessionId)!;
    expect(restored.messages.map(message => message.content)).toEqual(["message 3", "message 4"]);
    expect(second.persistence.searchHistory(session.sessionId, { query: "message" })).toHaveLength(4);
  });

  test("restores only the generation selected by current", () => {
    const first = createPersistence();
    const session = new SessionContext("atomic");
    session.addMessage({ role: "user", content: "committed", timestamp: 1 });
    first.persistence.checkpoint(session, "shutdown");

    const dir = first.persistence.getSessionDirectory(session.sessionId, false);
    const current = readlinkSync(resolve(dir, "current"));
    const orphan = resolve(dir, ".checkpoints", "g-999999999999-00000000-0000-4000-8000-000000000000");
    cpSync(resolve(dir, current), orphan, { recursive: true });
    const orphanLatest = readFileSync(resolve(orphan, "message-latest.jsonl"), "utf8")
      .replace("committed", "uncommitted");
    writeFileSync(resolve(orphan, "message-latest.jsonl"), orphanLatest);

    const second = createPersistence(first.root);
    expect(second.persistence.restore(session.sessionId)?.messages[0]?.content).toBe("committed");
  });

  test("reads latest from current instead of a stale compatibility link", () => {
    const { persistence } = createPersistence();
    const session = new SessionContext("latest-current");
    session.addMessage({ role: "user", content: "old checkpoint", timestamp: 1 });
    persistence.checkpoint(session, "message");
    session.addMessage({ role: "assistant", content: "new checkpoint", timestamp: 2 });
    persistence.checkpoint(session, "message");

    const dir = persistence.getSessionDirectory(session.sessionId, false);
    const previous = readdirSync(resolve(dir, ".checkpoints")).toSorted()[0]!;
    const facade = resolve(dir, "message-latest.jsonl");
    rmSync(facade);
    symlinkSync(`.checkpoints/${previous}/message-latest.jsonl`, facade, "file");

    expect(persistence.searchHistory(session.sessionId, { query: "new checkpoint" })).toHaveLength(1);
    expect(persistence.getHistoryArchiveRevision(session.sessionId, "message-latest")).toBe(2);
  });

  test("rejects a committed generation with mixed revisions", () => {
    const first = createPersistence();
    const session = new SessionContext("mismatch");
    session.addMessage({ role: "user", content: "message", timestamp: 1 });
    first.persistence.checkpoint(session, "shutdown");

    const dir = first.persistence.getSessionDirectory(session.sessionId, false);
    const current = resolve(dir, readlinkSync(resolve(dir, "current")));
    const contextPath = resolve(current, "context.json");
    const context = JSON.parse(readFileSync(contextPath, "utf8"));
    writeFileSync(contextPath, JSON.stringify({ ...context, checkpointRevision: 999 }));

    const second = createPersistence(first.root);
    expect(() => second.persistence.restore(session.sessionId)).toThrow("checkpoint revision mismatch");
  });

  test("rejects a broken current checkpoint pointer", () => {
    const first = createPersistence();
    const session = new SessionContext("broken-current");
    session.addMessage({ role: "user", content: "message", timestamp: 1 });
    first.persistence.checkpoint(session, "shutdown");

    const current = resolve(first.persistence.getSessionDirectory(session.sessionId, false), "current");
    rmSync(current);
    symlinkSync(".checkpoints/g-999999999999-00000000-0000-4000-8000-000000000000", current, "dir");

    const second = createPersistence(first.root);
    expect(() => second.persistence.restore(session.sessionId)).toThrow("Session checkpoint generation is missing");
  });

  test("retains only current and previous checkpoint generations", () => {
    const { persistence } = createPersistence();
    const session = new SessionContext("retention");
    for (let i = 0; i < 4; i++) {
      session.addMessage({ role: "user", content: `message ${i}`, timestamp: i });
      persistence.checkpoint(session, "message");
    }
    const dir = persistence.getSessionDirectory(session.sessionId, false);
    expect(readdirSync(resolve(dir, ".checkpoints")).filter(name => name.startsWith("g-"))).toHaveLength(2);
  });
});
