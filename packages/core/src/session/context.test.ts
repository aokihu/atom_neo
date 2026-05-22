import { describe, test, expect } from "bun:test";
import { SessionContext } from "./context";

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
