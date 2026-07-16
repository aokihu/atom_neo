import { describe, test, expect } from "bun:test";
import { decideTodoContinuation, SessionContext } from "./context";

describe("decideTodoContinuation", () => {
  const activeTodo = [{ content: "write report", status: "in_progress" as const, priority: "high" as const }];

  test("continues an active TODO below the chain limit", () => {
    expect(decideTodoContinuation(activeTodo, 4, 5)).toBe("continue");
  });

  test("stops an active TODO at the chain limit", () => {
    expect(decideTodoContinuation(activeTodo, 5, 5)).toBe("limit_reached");
  });

  test("ends when every TODO is terminal", () => {
    expect(decideTodoContinuation([
      { content: "write report", status: "completed", priority: "high" },
    ], 1, 5)).toBe("complete");
  });
});

describe("SessionContext", () => {
  test("initializes with sessionId", () => {
    const ctx = new SessionContext("test-session");
    expect(ctx.sessionId).toBe("test-session");
  });

  test("stores and retrieves messages", () => {
    const ctx = new SessionContext("s1");
    ctx.addMessage({ role: "user", content: "hello", timestamp: Date.now() });
    ctx.addMessage({ role: "assistant", content: "hi", timestamp: Date.now() });

    expect(ctx.messages.length).toBe(2);
    expect(ctx.messages[0].role).toBe("user");
    expect(ctx.messages[1].content).toBe("hi");
    expect(ctx.messages.map(message => message.seq)).toEqual([1, 2]);
  });

  test("removes only messages selected by stable sequence", () => {
    const ctx = new SessionContext("s1");
    ctx.addMessage({ role: "user", content: "one", timestamp: 1 });
    ctx.addMessage({ role: "assistant", content: "hidden", timestamp: 2, visible: false });
    ctx.addMessage({ role: "assistant", content: "three", timestamp: 3 });

    expect(ctx.removeMessages([1, 3])).toBe(2);
    expect(ctx.messages.map(message => message.content)).toEqual(["hidden"]);
  });

  test("exports and restores durable state while resetting runtime locks", () => {
    const ctx = new SessionContext("s1", 10);
    ctx.addMessage({ role: "user", content: "hello", timestamp: 11 });
    ctx.setTodoState([{ content: "continue", status: "in_progress", priority: "high" }]);
    ctx.compressing = true;
    const archives = { segmentCount: 0, archivedMessageCount: 0, latestMessageCount: 1, nextSegment: 1 };
    const state = ctx.exportState({ checkpointRevision: 1, status: "suspended", archives, reason: "shutdown" });

    const restored = SessionContext.restore(state, ctx.messages);
    expect(restored.createdAt).toBe(10);
    expect(restored.todoState[0]?.content).toBe("continue");
    expect(restored.compressing).toBe(false);
    expect(restored.messages[0]?.seq).toBe(1);
  });

  test("manages inference facts", () => {
    const ctx = new SessionContext("s1");
    ctx.addInferenceFact({ key: "project", value: "react", reason: "detected" });

    expect(ctx.inferenceFacts.length).toBe(1);

    ctx.setInferenceFacts([{ key: "lang", value: "ts", reason: "explicit" }]);
    expect(ctx.inferenceFacts.length).toBe(1);
    expect(ctx.inferenceFacts[0].key).toBe("lang");
  });

  test("manages tool context", () => {
    const ctx = new SessionContext("s1");
    expect(ctx.toolContext.mode).toBe("idle");

    ctx.setToolMode("active");
    expect(ctx.toolContext.mode).toBe("active");
  });

  test("manages memory scopes", () => {
    const ctx = new SessionContext("s1");
    expect(ctx.memoryScopes.core.status).toBe("idle");

    ctx.setMemoryScopeStatus("long", "searching", "project structure");
    expect(ctx.memoryScopes.long.status).toBe("searching");
    expect(ctx.memoryScopes.long.query).toBe("project structure");

    ctx.resetMemoryScopes();
    expect(ctx.memoryScopes.long.status).toBe("idle");
  });

  test("manages continuation context", () => {
    const ctx = new SessionContext("s1");
    expect(ctx.continuationContext).toBeNull();

    ctx.setContinuationContext({
      summary: "user wants to refactor",
      nextPrompt: "ask about scope",
      avoidRepeat: "don't suggest rewrite",
      updatedAt: Date.now(),
    });

    expect(ctx.continuationContext?.summary).toBe("user wants to refactor");

    ctx.clearContinuationContext();
    expect(ctx.continuationContext).toBeNull();
  });

  test("isolation between sessions", () => {
    const ctx1 = new SessionContext("a");
    const ctx2 = new SessionContext("b");

    ctx1.addMessage({ role: "user", content: "msg1", timestamp: 0 });

    expect(ctx1.messages.length).toBe(1);
    expect(ctx2.messages.length).toBe(0);
  });

});
