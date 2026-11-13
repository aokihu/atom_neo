import { describe, expect, test } from "bun:test";
import type { Message } from "../../types";
import { derivePipelineSteps, phaseCount } from "./runtime-steps";

const user = (content: string, timestamp: number): Message => ({ role: "user", content, id: `u-${timestamp}`, timestamp });
const assistant = (id: string, patch: Partial<Extract<Message, { role: "assistant" }>> = {}): Message => ({
  role: "assistant",
  content: "done",
  id,
  streaming: false,
  timestamp: 2,
  ...patch,
});
const tools = (id: string, entries: Extract<Message, { role: "tool-group" }>["entries"]): Message => ({
  role: "tool-group",
  id,
  timestamp: 2,
  collapsed: false,
  entries,
});

describe("derivePipelineSteps", () => {
  test("only considers the current user turn", () => {
    const messages = [
      user("old", 1),
      tools("old-tools", [{ toolCallId: "old", toolName: "read", phase: "done" }]),
      user("new", 3),
    ];
    expect(derivePipelineSteps(messages, false, false).map(step => step.state))
      .toEqual(["OK", "IDLE", "IDLE", "IDLE"]);
  });

  test("waits for tools and response while busy without evidence", () => {
    expect(derivePipelineSteps([user("new", 1)], true, false).map(step => step.state))
      .toEqual(["OK", "OK", "WAIT", "WAIT"]);
  });

  test("keeps completed tools and responses after the turn settles", () => {
    const messages = [
      user("new", 1),
      tools("tools", [{ toolCallId: "a", toolName: "read", phase: "done" }]),
      assistant("answer"),
    ];
    expect(derivePipelineSteps(messages, false, false).map(step => step.state))
      .toEqual(["OK", "OK", "OK", "OK"]);
  });
});

describe("phaseCount", () => {
  test("counts matching tool phases across groups", () => {
    const messages = [
      tools("one", [
        { toolCallId: "a", toolName: "read", phase: "done" },
        { toolCallId: "b", toolName: "shell", phase: "error" },
      ]),
      user("next", 3),
      tools("two", [{ toolCallId: "c", toolName: "read", phase: "done" }]),
    ];
    expect(phaseCount(messages, "done")).toBe(2);
    expect(phaseCount(messages, "error")).toBe(1);
    expect(phaseCount(messages, "executing")).toBe(0);
  });
});
