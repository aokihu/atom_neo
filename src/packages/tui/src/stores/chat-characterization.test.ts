import { beforeEach, describe, expect, test } from "bun:test";
import { useChatStore } from "./chat";
import { mapChatSnapshot } from "../hooks/chat-connection";
import type { Message } from "../types";
import type { DecisionUpdatePayload } from "@atom-neo/shared";

const initialState = {
  messages: [],
  toolGroupId: null,
  activeAssistantId: null,
  busy: false,
  showPreparing: false,
  contextTokens: 0,
  streamReceivedChars: 0,
  streamChunkCount: 0,
  streamTokenBatches: [],
  todoItems: [],
  rounds: null,
  telemetryOnline: false,
  toolInfos: [],
  mcpServers: [],
  predictionDecision: null,
  postDecision: null,
};

const reset = () => useChatStore.setState(initialState);

const assistant = () => {
  const message = useChatStore.getState().messages.at(-1);
  if (!message || message.role !== "assistant") throw new Error("expected assistant message");
  return message;
};

describe("chat store characterization", () => {
  beforeEach(reset);

  test("starts from the documented empty state and exposes every action", () => {
    expect(useChatStore.getState()).toMatchObject(initialState);
    for (const action of [
      "generateId", "addMessage", "addTransientMessage", "updateMessage", "clearMessages",
      "handleDelta", "handleReason", "handleToolEvent", "handleToolStepFinish",
      "handleToolGroupComplete", "recordStreamChunk", "setBusy", "setContextTokens",
      "setTodoItems", "setToolInfos", "updateMCPConnected", "updateMCPStatus",
      "setDecisionUpdate", "prepareForSend", "setShowPreparing",
    ]) {
      expect(typeof (useChatStore.getState() as unknown as Record<string, unknown>)[action]).toBe("function");
    }
    expect(useChatStore.getState().rounds).toBeNull();
    expect(useChatStore.getState().predictionDecision).toBeNull();
    expect(Object.keys(useChatStore.getState()).sort()).toEqual([
      "activeAssistantId", "addMessage", "addTransientMessage", "busy", "clearMessages",
      "contextTokens", "generateId", "handleDelta", "handleReason", "handleToolEvent",
      "handleToolGroupComplete", "handleToolStepFinish", "mcpServers", "messages",
      "postDecision", "predictionDecision", "prepareForSend", "recordStreamChunk",
      "rounds", "setBusy", "setContextTokens", "setDecisionUpdate", "setShowPreparing",
      "setTodoItems", "setToolInfos", "showPreparing", "streamChunkCount",
      "streamReceivedChars", "streamTokenBatches", "telemetryOnline", "todoItems",
      "toolGroupId", "toolInfos", "updateMCPConnected", "updateMCPStatus", "updateMessage",
    ].sort());
  });

  test("creates one assistant for the first delta and applies the server offset on later deltas", () => {
    useChatStore.getState().handleDelta("hello", 0, "thinking", 3);
    const created = assistant();
    expect(created).toMatchObject({
      role: "assistant",
      content: "hello",
      streaming: true,
      reasoningContent: "thinking",
      thinkingDuration: 3,
    });
    expect(created.id).toMatch(/^msg-\d+-\d+$/);
    expect(useChatStore.getState().activeAssistantId).toBe(created.id);
    expect(useChatStore.getState().showPreparing).toBe(false);

    useChatStore.getState().handleDelta("X", 5);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(assistant().content).toBe("helloX");
    expect(assistant().reasoningContent).toBe("thinking");
  });

  test("treats reasoning as stream activity without creating a message", () => {
    useChatStore.setState({ showPreparing: true });
    useChatStore.getState().handleReason("abc");
    expect(useChatStore.getState().showPreparing).toBe(false);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState()).toMatchObject({
      streamReceivedChars: 3,
      streamChunkCount: 1,
      streamTokenBatches: [1],
    });

    useChatStore.getState().handleReason("");
    expect(useChatStore.getState().streamChunkCount).toBe(1);
  });

  test("records the latest eight token estimate batches", () => {
    for (const size of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      useChatStore.getState().recordStreamChunk("x".repeat(size));
    }
    expect(useChatStore.getState()).toMatchObject({
      streamReceivedChars: 45,
      streamChunkCount: 9,
      streamTokenBatches: [1, 1, 1, 2, 2, 2, 2, 3],
    });
  });

  test("creates, updates, and completes a tool group while ending the active assistant", () => {
    useChatStore.getState().handleDelta("working", 0);
    expect(useChatStore.getState().handleToolEvent({ name: "read", callId: "call-1", input: { path: "a" } })).toBe("created");

    const created = useChatStore.getState().messages[0];
    expect(created?.role === "assistant" && created.streaming).toBe(false);
    const groupId = useChatStore.getState().toolGroupId;
    expect(groupId).not.toBeNull();
    expect(useChatStore.getState().messages[1]).toMatchObject({
      role: "tool-group",
      id: groupId,
      collapsed: false,
      entries: [{ toolCallId: "call-1", toolName: "read", phase: "executing", input: { path: "a" } }],
    });

    expect(useChatStore.getState().handleToolEvent({ name: "read", callId: "call-1", input: { path: "a" } })).toBe("updated");
    expect((useChatStore.getState().messages[1] as any).entries).toHaveLength(1);

    expect(useChatStore.getState().handleToolEvent({ name: "read", callId: "call-1", result: "ok" })).toBe("updated");
    expect((useChatStore.getState().messages[1] as any).entries[0]).toMatchObject({ phase: "done", detail: "ok" });

    useChatStore.getState().handleToolEvent({ name: "grep", callId: "call-2", input: {} });
    useChatStore.getState().handleToolEvent({ name: "grep", callId: "call-2", error: "boom" });
    expect((useChatStore.getState().messages[1] as any).entries[1]).toMatchObject({ phase: "error", detail: "boom" });

    useChatStore.getState().handleToolStepFinish(2, 1, 1, ["read", "grep"]);
    expect((useChatStore.getState().messages[1] as any).summary).toBeUndefined();

    useChatStore.getState().handleToolGroupComplete(2, 1, 1, ["read", "grep"]);
    expect(useChatStore.getState().toolGroupId).toBeNull();
    expect(useChatStore.getState().messages[1]).toMatchObject({
      collapsed: true,
      summary: { total: 2, success: 1, failed: 1, toolNames: ["read", "grep"] },
    });

    useChatStore.getState().handleToolGroupComplete(9, 9, 0, ["ignored"]);
    expect((useChatStore.getState().messages[1] as any).summary.total).toBe(2);
  });

  test("creates a fresh tool group after completion", () => {
    useChatStore.getState().handleToolEvent({ name: "read", callId: "one", input: {} });
    useChatStore.getState().handleToolGroupComplete(1, 1, 0, ["read"]);
    useChatStore.getState().handleToolEvent({ name: "read", callId: "two", input: {} });
    const groups = useChatStore.getState().messages.filter(message => message.role === "tool-group");
    expect(groups).toHaveLength(2);
    expect((groups[1] as any).entries[0].toolCallId).toBe("two");
  });

  test("busy false closes streaming without touching the message history", () => {
    useChatStore.getState().handleDelta("hello", 0);
    useChatStore.setState({ showPreparing: true });
    useChatStore.getState().setBusy(true);
    expect(useChatStore.getState()).toMatchObject({ busy: true, activeAssistantId: assistant().id });

    useChatStore.getState().setBusy(false);
    expect(useChatStore.getState()).toMatchObject({ busy: false, showPreparing: false, activeAssistantId: null });
    expect(assistant()).toMatchObject({ content: "hello", streaming: false });
  });

  test("prepareForSend resets the turn but keeps previous messages", () => {
    const decision = { sessionId: "s", taskId: "t", rootTaskId: "r", source: "llm", purpose: "prediction", state: "ok" } as DecisionUpdatePayload;
    useChatStore.getState().addMessage({ role: "user", content: "old", id: "old", timestamp: 1 });
    useChatStore.getState().handleToolEvent({ name: "read", callId: "call", input: {} });
    useChatStore.setState({ predictionDecision: decision, postDecision: decision, streamReceivedChars: 10, streamChunkCount: 2, streamTokenBatches: [3] });

    useChatStore.getState().prepareForSend();
    expect(useChatStore.getState()).toMatchObject({
      toolGroupId: null,
      activeAssistantId: null,
      showPreparing: true,
      busy: true,
      streamReceivedChars: 0,
      streamChunkCount: 0,
      streamTokenBatches: [],
      predictionDecision: null,
      postDecision: null,
    });
    expect(useChatStore.getState().messages).toHaveLength(2);
  });

  test("clearMessages only clears conversation and stream state", () => {
    useChatStore.getState().addMessage({ role: "user", content: "old", id: "old", timestamp: 1 });
    useChatStore.setState({
      toolGroupId: "group", activeAssistantId: "assistant", streamReceivedChars: 4,
      streamChunkCount: 1, streamTokenBatches: [1], busy: true, showPreparing: true,
      contextTokens: 42, telemetryOnline: true,
    });

    useChatStore.getState().clearMessages();
    expect(useChatStore.getState()).toMatchObject({
      messages: [],
      toolGroupId: null,
      activeAssistantId: null,
      streamReceivedChars: 0,
      streamChunkCount: 0,
      streamTokenBatches: [],
      busy: true,
      showPreparing: true,
      contextTokens: 42,
      telemetryOnline: true,
    });
  });

  test("updates and removes transient messages by id", async () => {
    useChatStore.getState().addMessage({ role: "info", content: "keep", id: "keep", timestamp: 1 });
    useChatStore.getState().addTransientMessage({ role: "info", content: "hide", id: "hide", timestamp: 2 }, 10);
    useChatStore.getState().updateMessage("keep", { content: "updated" });
    expect(useChatStore.getState().messages).toHaveLength(2);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(useChatStore.getState().messages).toEqual([
      { role: "info", content: "updated", id: "keep", timestamp: 1 },
    ]);
  });

  test("keeps both decision purposes and clears them for the next turn", () => {
    const identity = { sessionId: "s", taskId: "t", rootTaskId: "r", source: "llm" as const };
    useChatStore.getState().setDecisionUpdate({ ...identity, purpose: "prediction", state: "ok", intent: "instruction" });
    useChatStore.getState().setDecisionUpdate({ ...identity, purpose: "post-conversation", state: "err" });
    expect(useChatStore.getState().predictionDecision?.intent).toBe("instruction");
    expect(useChatStore.getState().postDecision?.state).toBe("err");

    useChatStore.getState().prepareForSend();
    expect(useChatStore.getState().predictionDecision).toBeNull();
    expect(useChatStore.getState().postDecision).toBeNull();
  });

  test("merges MCP tools, replaces MCP servers, and only updates known server status", () => {
    useChatStore.setState({
      toolInfos: [
        { name: "read", source: "builtin" },
        { name: "old-mcp", source: "mcp" },
      ],
      mcpServers: [{ name: "alpha", online: false, toolCount: 1 }, { name: "beta", online: true, toolCount: 2 }],
    });

    useChatStore.getState().updateMCPConnected({
      servers: [{ name: "alpha", online: true, toolCount: 3 }],
      toolInfos: [{ name: "new-mcp", source: "mcp", description: "new", online: true }],
    });
    expect(useChatStore.getState().toolInfos).toEqual([
      { name: "read", source: "builtin" },
      { name: "new-mcp", source: "mcp", description: "new", online: true },
    ]);
    expect(useChatStore.getState().mcpServers).toEqual([{ name: "alpha", online: true, toolCount: 3 }]);

    useChatStore.getState().updateMCPStatus([
      { name: "alpha", online: false, toolNames: ["new-mcp"] },
      { name: "missing", online: true, toolNames: [] },
    ]);
    expect(useChatStore.getState().mcpServers).toEqual([{ name: "alpha", online: false, toolCount: 3 }]);
  });

  test("stores context tokens, todos, and tool infos", () => {
    const todos = [{ content: "task", status: "pending" as const, priority: "medium" as const }];
    useChatStore.getState().setContextTokens(1234);
    useChatStore.getState().setTodoItems(todos);
    useChatStore.getState().setToolInfos([{ name: "read", source: "builtin" }]);
    expect(useChatStore.getState()).toMatchObject({
      contextTokens: 1234,
      todoItems: todos,
      toolInfos: [{ name: "read", source: "builtin" }],
    });
  });

  test("snapshot mapping filters visible user/assistant messages and normalizes ids", () => {
    const messages = mapChatSnapshot("session-a", [
      { role: "user", content: "hi", timestamp: 10 },
      { role: "assistant", content: "hello", timestamp: 20, seq: 7 },
      { role: "tool-group", content: "hidden", timestamp: 30 },
      { role: "assistant", content: "hidden", timestamp: 40, visible: false },
    ]);
    expect(messages).toEqual([
      { id: "session-a-10", role: "user", content: "hi", timestamp: 10, streaming: false },
      { id: "session-a-7", role: "assistant", content: "hello", timestamp: 20, streaming: false },
    ] as Message[]);
  });
});
