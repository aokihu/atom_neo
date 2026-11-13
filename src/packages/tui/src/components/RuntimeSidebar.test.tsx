import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "@opentui/react";
import { createTestRenderer } from "@opentui/core/testing";
import type { DecisionUpdatePayload } from "@atom-neo/shared";
import { RuntimeSidebar, derivePipelineSteps } from "./RuntimeSidebar";
import { useChatStore } from "../stores/chat";
import type { Message } from "../types";

const decision = (patch: Partial<DecisionUpdatePayload>): DecisionUpdatePayload => ({
  sessionId: "s",
  taskId: "t",
  rootTaskId: "r",
  purpose: "prediction",
  source: "jev",
  state: "ok",
  ...patch,
});

const messages: Message[] = [
  { role: "user", content: "go", id: "u", timestamp: 1 },
  {
    role: "tool-group",
    id: "tools",
    timestamp: 2,
    collapsed: false,
    entries: [
      { toolCallId: "a", toolName: "read", phase: "done" },
      { toolCallId: "b", toolName: "webfetch", phase: "error" },
    ],
  },
  { role: "assistant", content: "hi", id: "a", timestamp: 3, streaming: true },
];

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => {
  useChatStore.setState({
    messages: [],
    busy: false,
    showPreparing: false,
    predictionDecision: null,
    postDecision: null,
    streamReceivedChars: 0,
    streamChunkCount: 0,
    streamTokenBatches: [],
  });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
});

test("RUNTIME renders session, pipeline, decision, stream and stats sections", async () => {
  const setup = await createTestRenderer({ width: 30, height: 40 });
  const root = createRoot(setup.renderer);
  try {
    useChatStore.setState({
      messages,
      busy: true,
      showPreparing: false,
      predictionDecision: decision({ intent: "code", modelProfile: "m", topic: "a long topic beyond sixteen" }),
      postDecision: decision({ purpose: "post-conversation", source: "llm", analysisStatus: "completed" }),
      streamReceivedChars: 40,
      streamChunkCount: 3,
      streamTokenBatches: [1, 2, 4],
    });
    await act(async () => root.render(<RuntimeSidebar />));
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("RUNTIME");
    expect(frame).toContain("SESSION");
    expect(frame).toContain("ACTIVE");
    expect(frame).toContain("UPTIME");
    expect(frame).toContain("QUEUE");
    expect(frame).toContain("1 ACTIVE");
    expect(frame).toContain("PIPELINE");
    for (const label of ["RECEIVE", "THINK", "TOOLS", "RESPOND"]) expect(frame).toContain(label);
    expect(frame).toContain("DECISION");
    expect(frame).toContain("PREDICT");
    expect(frame).toContain("POST CHECK");
    expect(frame).toContain("JEV OK");
    expect(frame).toContain("LLM OK");
    expect(frame).toContain("INTENT code");
    expect(frame).toContain("MODEL  m");
    expect(frame).toContain("TOPIC  a long topic bey");
    expect(frame).toContain("STATUS completed");
    expect(frame).toContain("STREAM");
    expect(frame).toContain("≈10 TOK");
    expect(frame).toContain("3 CH");
    expect(frame).toContain("STATS");
    expect(frame).toContain("MESSAGES");
    expect(frame).toContain("TOOLS OK");
    expect(frame).toContain("TOOLS ERR");
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  }
});

test("RUNTIME shows idle and empty states without a turn", async () => {
  const setup = await createTestRenderer({ width: 30, height: 40 });
  const root = createRoot(setup.renderer);
  try {
    await act(async () => root.render(<RuntimeSidebar />));
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("IDLE");
    expect(frame).toContain("EMPTY");
    expect(frame).toContain("PREDICT");
    expect(frame).toContain("—");
    expect(derivePipelineSteps([], false, false).map(step => step.state))
      .toEqual(["IDLE", "IDLE", "IDLE", "IDLE"]);
  } finally {
    await act(async () => root.unmount());
    setup.renderer.destroy();
  }
});
