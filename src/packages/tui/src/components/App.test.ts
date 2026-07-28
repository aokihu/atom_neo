import { describe, expect, test } from "bun:test";
import { resolveTuiLayout } from "./App";
import { derivePipelineSteps } from "./RuntimeSidebar";
import { buildNormalizedStreamActivity, estimateReceivedTokens } from "./format";
import { buildGauge, SIDEBAR_CONTENT_WIDTH } from "./Sidebar";
import { placeCompletedToolGroups } from "./ChatView";
import { summarizeToolGroups } from "./ToolMessageBox";
import type { Message } from "../types";

const user = (content = "hello"): Message => ({
  role: "user",
  content,
  id: `user-${content}`,
  timestamp: 1,
});

const assistant = (id: string, reasoning = true): Message => ({
  role: "assistant",
  content: "done",
  id,
  streaming: false,
  timestamp: 2,
  reasoningContent: reasoning ? "thought" : undefined,
});

const toolGroup = (id: string, collapsed = true): Message => ({
  role: "tool-group",
  id,
  timestamp: 2,
  collapsed,
  entries: [
    { toolCallId: `${id}-ok`, toolName: "read", phase: "done", detail: "result" },
    { toolCallId: `${id}-err`, toolName: "webfetch", phase: "error", detail: "failed" },
  ],
  summary: collapsed
    ? { total: 2, success: 1, failed: 1, toolNames: ["read", "webfetch"] }
    : undefined,
});

describe("resolveTuiLayout", () => {
  test("keeps conversation only below 100 columns", () => {
    expect(resolveTuiLayout(99)).toBe("compact");
  });

  test("adds telemetry at 100 columns", () => {
    expect(resolveTuiLayout(100)).toBe("medium");
    expect(resolveTuiLayout(149)).toBe("medium");
  });

  test("adds runtime at 150 columns", () => {
    expect(resolveTuiLayout(150)).toBe("wide");
  });
});

describe("derivePipelineSteps", () => {
  test("shows idle before the first request", () => {
    expect(derivePipelineSteps([], false, false).map(step => step.state))
      .toEqual(["IDLE", "IDLE", "IDLE", "IDLE"]);
  });

  test("shows preparing and waiting stages after input", () => {
    expect(derivePipelineSteps([user()], true, true).map(step => step.state))
      .toEqual(["OK", "RUN", "WAIT", "WAIT"]);
  });

  test("derives tool and response activity from the current turn", () => {
    const messages: Message[] = [
      user(),
      {
        role: "tool-group",
        id: "tools",
        timestamp: 2,
        collapsed: false,
        entries: [{ toolCallId: "call-1", toolName: "webfetch", phase: "executing" }],
      },
      {
        role: "assistant",
        id: "assistant",
        timestamp: 3,
        content: "working",
        streaming: true,
      },
    ];

    expect(derivePipelineSteps(messages, true, false).map(step => step.state))
      .toEqual(["OK", "OK", "RUN", "RUN"]);
  });

  test("surfaces a tool error", () => {
    const messages: Message[] = [
      user(),
      {
        role: "tool-group",
        id: "tools",
        timestamp: 2,
        collapsed: false,
        entries: [{ toolCallId: "call-1", toolName: "webfetch", phase: "error" }],
      },
    ];

    expect(derivePipelineSteps(messages, false, false)[2]?.state).toBe("ERR");
  });
});

describe("buildGauge", () => {
  test("fills the telemetry content width", () => {
    expect(buildGauge(0, 1_000_000, SIDEBAR_CONTENT_WIDTH)).toHaveLength(SIDEBAR_CONTENT_WIDTH);
  });
});

describe("stream activity", () => {
  test("normalizes the latest batches against the window maximum", () => {
    expect(buildNormalizedStreamActivity([1, 2, 4, 8])).toBe("    ▁▂▄█");
    expect(buildNormalizedStreamActivity([8, 4, 2, 1, 16, 8, 4, 2, 1])).toBe("▂▁▁█▄▂▁▁");
  });

  test("keeps missing data empty and marks the token count as estimated", () => {
    expect(buildNormalizedStreamActivity([])).toBe("        ");
    expect(estimateReceivedTokens(0)).toBe(0);
    expect(estimateReceivedTokens(9)).toBe(3);
  });
});

describe("completed tool presentation", () => {
  test("places completed tools on the latest Thought in the same user turn", () => {
    const messages = [
      user(),
      toolGroup("before"),
      assistant("middle"),
      toolGroup("after"),
      assistant("final", false),
    ];

    const placement = placeCompletedToolGroups(messages);
    expect(placement.byAssistantId.get("middle")?.map(group => group.id)).toEqual(["before", "after"]);
    expect(placement.byAssistantId.get("final")).toBeUndefined();
    expect([...placement.attachedGroupIds]).toEqual(["before", "after"]);
  });

  test("keeps executing tool groups in the conversation", () => {
    const placement = placeCompletedToolGroups([user(), toolGroup("running", false), assistant("final")]);
    expect(placement.byAssistantId.size).toBe(0);
    expect(placement.attachedGroupIds.size).toBe(0);
  });

  test("aggregates progress for the inline summary and modal", () => {
    expect(summarizeToolGroups([
      toolGroup("one") as Extract<Message, { role: "tool-group" }>,
      toolGroup("two") as Extract<Message, { role: "tool-group" }>,
    ])).toEqual({ total: 4, success: 2, failed: 2 });
  });
});
