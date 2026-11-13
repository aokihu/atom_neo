import { beforeEach, describe, expect, test } from "bun:test";
import { TaskFailureCodes, type DecisionUpdatePayload, type SessionTelemetry } from "@atom-neo/shared";
import { connectChat, submitChatMessage } from "./chat-connection";
import type { ChatConnectionClient, ChatSnapshotMessage } from "./chat-connection";
import { useChatStore } from "../stores/chat";
import type { Message } from "../types";

class FakeChatClient implements ChatConnectionClient {
  sessionId = "session-a";
  bindings: string[] = [];
  sent: string[] = [];
  closed = false;
  compacted = 0;
  cancelled = 0;
  connectError: Error | undefined;
  sendError: Error | undefined;
  connectionParams: { url: string; sessionId?: string } | undefined;

  #snapshot?: (messages: ChatSnapshotMessage[]) => void;
  #telemetry?: (telemetry: SessionTelemetry) => void;
  #disconnect?: () => void;
  #delta?: (delta: string, offset: number) => void;
  #reason?: (delta: string, offset: number) => void;
  #tool?: (event: { name: string; callId: string; input?: unknown; result?: unknown; error?: unknown }) => void;
  #toolStep?: (event: { total: number; success: number; failed: number; toolNames: string[] }) => void;
  #toolGroup?: (event: { total: number; success: number; failed: number; toolNames: string[] }) => void;
  #context?: (total: number) => void;
  #busy?: (busy: boolean) => void;
  #mcpStatus?: (servers: { name: string; online: boolean; toolNames: string[] }[]) => void;
  #mcpConnected?: (data: { servers: { name: string; online: boolean; toolCount: number }[]; toolInfos: { name: string; source: string; description: string; online: boolean }[] }) => void;
  #decision?: (update: DecisionUpdatePayload) => void;

  async connect(): Promise<void> {
    if (this.connectError) throw this.connectError;
  }

  close(): void { this.closed = true; }
  async send(text: string): Promise<string> {
    if (this.sendError) throw this.sendError;
    this.sent.push(text);
    return text;
  }
  sendCompact(): void { this.compacted += 1; }
  cancelActiveTask(): boolean { this.cancelled += 1; return true; }

  onSnapshot(cb: (messages: ChatSnapshotMessage[]) => void): void { this.bindings.push("snapshot"); this.#snapshot = cb; }
  onDisconnect(cb: () => void): void { this.bindings.push("disconnect"); this.#disconnect = cb; }
  onDelta(cb: (delta: string, offset: number) => void): void { this.bindings.push("delta"); this.#delta = cb; }
  onReason(cb: (delta: string, offset: number) => void): void { this.bindings.push("reason"); this.#reason = cb; }
  onTool(cb: (event: { name: string; callId: string; input?: unknown; result?: unknown; error?: unknown }) => void): void { this.bindings.push("tool"); this.#tool = cb; }
  onToolStepFinish(cb: (event: { total: number; success: number; failed: number; toolNames: string[] }) => void): void { this.bindings.push("tool-step"); this.#toolStep = cb; }
  onToolGroupComplete(cb: (event: { total: number; success: number; failed: number; toolNames: string[] }) => void): void { this.bindings.push("tool-group"); this.#toolGroup = cb; }
  onContextTokens(cb: (total: number) => void): void { this.bindings.push("context"); this.#context = cb; }
  onTelemetry(cb: (telemetry: SessionTelemetry) => void): void { this.bindings.push("telemetry"); this.#telemetry = cb; }
  onBusyChange(cb: (busy: boolean) => void): void { this.bindings.push("busy"); this.#busy = cb; }
  onMCPStatus(cb: (servers: { name: string; online: boolean; toolNames: string[] }[]) => void): void { this.bindings.push("mcp-status"); this.#mcpStatus = cb; }
  onMCPConnected(cb: (data: { servers: { name: string; online: boolean; toolCount: number }[]; toolInfos: { name: string; source: string; description: string; online: boolean }[] }) => void): void { this.bindings.push("mcp-connected"); this.#mcpConnected = cb; }
  onDecisionUpdate(cb: (update: DecisionUpdatePayload) => void): void { this.bindings.push("decision"); this.#decision = cb; }

  emitSnapshot(messages: ChatSnapshotMessage[]): void { this.#snapshot?.(messages); }
  emitTelemetry(telemetry: SessionTelemetry): void { this.#telemetry?.(telemetry); }
  emitDisconnect(): void { this.#disconnect?.(); }
  emitReason(delta: string): void { this.#reason?.(delta, 0); }
  emitDelta(delta: string, offset: number): void { this.#delta?.(delta, offset); }
  emitTool(event: { name: string; callId: string; input?: unknown; result?: unknown; error?: unknown }): void { this.#tool?.(event); }
  emitToolStep(event: { total: number; success: number; failed: number; toolNames: string[] }): void { this.#toolStep?.(event); }
  emitToolGroup(event: { total: number; success: number; failed: number; toolNames: string[] }): void { this.#toolGroup?.(event); }
  emitContext(total: number): void { this.#context?.(total); }
  emitBusy(busy: boolean): void { this.#busy?.(busy); }
  emitMCPStatus(servers: { name: string; online: boolean; toolNames: string[] }[]): void { this.#mcpStatus?.(servers); }
  emitMCPConnected(data: { servers: { name: string; online: boolean; toolCount: number }[]; toolInfos: { name: string; source: string; description: string; online: boolean }[] }): void { this.#mcpConnected?.(data); }
  emitDecision(update: DecisionUpdatePayload): void { this.#decision?.(update); }
}

const reset = () => useChatStore.setState({
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
});

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

function connect(fake: FakeChatClient) {
  return connectChat({
    url: "http://localhost:3100",
    sessionId: "session-a",
    initialToolInfos: [{ name: "read", source: "builtin" }],
    initialMCPServers: [{ name: "alpha", online: true, toolCount: 2 }],
    createClient: params => {
      fake.connectionParams = params;
      return fake;
    },
  });
}

describe("chat connection adapter", () => {
  beforeEach(reset);

  test("binds callbacks in the original order and closes the client", () => {
    const fake = new FakeChatClient();
    const connection = connect(fake);
    expect(fake.connectionParams).toEqual({ url: "http://localhost:3100", sessionId: "session-a" });
    expect(fake.bindings).toEqual([
      "snapshot", "telemetry", "disconnect", "context", "reason", "delta",
      "tool", "tool-step", "tool-group", "busy", "decision", "mcp-connected", "mcp-status",
    ]);
    expect(useChatStore.getState().toolInfos).toEqual([{ name: "read", source: "builtin" }]);
    expect(useChatStore.getState().mcpServers).toEqual([{ name: "alpha", online: true, toolCount: 2 }]);
    expect(useChatStore.getState()).toMatchObject({ rounds: null, todoItems: [], telemetryOnline: false });

    connection.close();
    expect(fake.closed).toBe(true);
  });

  test("routes snapshot and telemetry events into the store", () => {
    const fake = new FakeChatClient();
    const connection = connect(fake);
    useChatStore.setState({
      predictionDecision: { purpose: "prediction", state: "ok" } as DecisionUpdatePayload,
      postDecision: { purpose: "post-conversation", state: "ok" } as DecisionUpdatePayload,
    });

    fake.emitSnapshot([
      { role: "user", content: "hi", timestamp: 10 },
      { role: "assistant", content: "hello", timestamp: 20, seq: 3 },
      { role: "tool-group", content: "ignored", timestamp: 30 },
    ]);
    expect(useChatStore.getState().messages).toEqual([
      { id: "session-a-10", role: "user", content: "hi", timestamp: 10, streaming: false },
      { id: "session-a-3", role: "assistant", content: "hello", timestamp: 20, streaming: false },
    ] as Message[]);
    expect(useChatStore.getState().predictionDecision).toBeNull();
    expect(useChatStore.getState().postDecision).toBeNull();

    fake.emitTelemetry({
      sessionId: "session-a",
      rounds: { goalId: "g", globalUsed: 15, globalAllowance: 100, localUsed: 0, localLimit: 5 },
      todos: [{ content: "restored", status: "pending", priority: "medium" }],
    });
    expect(useChatStore.getState()).toMatchObject({
      telemetryOnline: true,
      rounds: { globalUsed: 15 },
      todoItems: [{ content: "restored" }],
    });
    connection.close();
  });

  test("combines reasoning with the first delta and clears the reasoning buffer afterwards", () => {
    const fake = new FakeChatClient();
    const connection = connect(fake);
    useChatStore.setState({ showPreparing: true });

    fake.emitReason("think");
    expect(useChatStore.getState().showPreparing).toBe(false);
    expect(useChatStore.getState().messages).toEqual([]);
    fake.emitDelta("hello", 0);
    const first = useChatStore.getState().messages[0];
    expect(first).toMatchObject({ role: "assistant", content: "hello", reasoningContent: "think" });
    if (first?.role !== "assistant") throw new Error("expected assistant");
    expect(typeof first.thinkingDuration).toBe("number");

    fake.emitReason("next");
    fake.emitDelta("X", 5);
    expect(useChatStore.getState().messages[0]).toMatchObject({
      content: "helloX",
      reasoningContent: "think",
    });
    connection.close();
  });

  test("routes context, tool, busy, decision, and MCP events", () => {
    const fake = new FakeChatClient();
    const connection = connect(fake);

    fake.emitContext(4096);
    expect(useChatStore.getState().contextTokens).toBe(4096);

    fake.emitTool({ name: "read", callId: "call-1", input: {} });
    fake.emitToolStep({ total: 1, success: 0, failed: 0, toolNames: ["read"] });
    fake.emitToolGroup({ total: 1, success: 1, failed: 0, toolNames: ["read"] });
    expect(useChatStore.getState().toolGroupId).toBeNull();
    expect(useChatStore.getState().messages[0]).toMatchObject({
      role: "tool-group",
      collapsed: true,
      summary: { total: 1, success: 1, failed: 0, toolNames: ["read"] },
    });

    fake.emitBusy(true);
    expect(useChatStore.getState().busy).toBe(true);
    fake.emitBusy(false);
    expect(useChatStore.getState().busy).toBe(false);

    fake.emitDecision({ sessionId: "session-a", taskId: "t", rootTaskId: "r", purpose: "prediction", source: "llm", state: "ok" });
    expect(useChatStore.getState().predictionDecision?.state).toBe("ok");

    fake.emitMCPConnected({
      servers: [{ name: "alpha", online: true, toolCount: 2 }],
      toolInfos: [{ name: "mcp-tool", source: "mcp", description: "tool", online: true }],
    });
    expect(useChatStore.getState().toolInfos).toContainEqual({ name: "mcp-tool", source: "mcp", description: "tool", online: true });

    fake.emitMCPStatus([{ name: "alpha", online: false, toolNames: ["mcp-tool"] }]);
    expect(useChatStore.getState().mcpServers).toEqual([{ name: "alpha", online: false, toolCount: 2 }]);
    connection.close();
  });

  test("adds a disconnect error and ignores late telemetry after cleanup", () => {
    const fake = new FakeChatClient();
    const connection = connect(fake);
    fake.emitTelemetry({ sessionId: "session-a", rounds: null, todos: [] });
    expect(useChatStore.getState().telemetryOnline).toBe(true);

    fake.emitDisconnect();
    expect(useChatStore.getState()).toMatchObject({ rounds: null, todoItems: [], telemetryOnline: false });
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      role: "error",
      content: "Core disconnected. Attach again to resume this session.",
    });

    connection.close();
    const messageCount = useChatStore.getState().messages.length;
    fake.emitDisconnect();
    fake.emitTelemetry({ sessionId: "session-a", rounds: null, todos: [] });
    expect(useChatStore.getState().messages).toHaveLength(messageCount);
    expect(useChatStore.getState().telemetryOnline).toBe(false);
  });

  test("reports connection failures as an error message", async () => {
    const fake = new FakeChatClient();
    fake.connectError = new Error("offline");
    const connection = connect(fake);
    await nextTurn();
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({ role: "error", content: "Connection failed" });
    connection.close();
  });

  test("submits a user message and delegates compact/cancel", async () => {
    const fake = new FakeChatClient();
    const connection = connect(fake);

    await connection.send("hello");
    expect(fake.sent).toEqual(["hello"]);
    expect(useChatStore.getState().messages).toEqual([
      { role: "user", content: "hello", id: expect.stringMatching(/^msg-\d+-\d+$/), timestamp: expect.any(Number) },
    ]);
    expect(useChatStore.getState()).toMatchObject({ busy: true, showPreparing: true, streamReceivedChars: 0 });

    connection.compact();
    expect(fake.compacted).toBe(1);
    expect(connection.cancel()).toBe(true);
    expect(fake.cancelled).toBe(1);
    connection.close();
  });

  test("maps API key failures to the client error callback and cancellation to a transient info", async () => {
    const fake = new FakeChatClient();
    const connection = connect(fake);
    const errors: string[] = [];
    fake.sendError = Object.assign(new Error("rejected"), { code: TaskFailureCodes.ApiKeyInvalid });
    await connection.send("hi", error => errors.push(error.code));
    expect(errors).toEqual([TaskFailureCodes.ApiKeyInvalid]);
    expect(useChatStore.getState().messages.some(message => message.role === "error")).toBe(false);

    fake.sendError = Object.assign(new Error("cancelled"), { name: "TaskCancelledError" });
    await connection.send("again");
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({ role: "info", content: "Task cancelled by user" });
    connection.close();
  });

  test("reports a missing client as not connected", async () => {
    await submitChatMessage(null, "hello");
    expect(useChatStore.getState().messages).toEqual([
      { role: "user", content: "hello", id: expect.stringMatching(/^msg-\d+-\d+$/), timestamp: expect.any(Number) },
      { role: "error", content: "Not connected", id: expect.stringMatching(/^msg-\d+-\d+$/), timestamp: expect.any(Number) },
    ]);
  });
});
