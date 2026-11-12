import { describe, expect, test } from "bun:test";
import { buildChatViewModel, placeCompletedToolGroups } from "./chat-view-model";
import type { Message } from "../types";

const user = (content = "hello"): Message => ({ role: "user", content, id: `user-${content}`, timestamp: 1 });
const assistant = (id: string): Message => ({
  role: "assistant", content: "done", id, streaming: false, timestamp: 2, reasoningContent: "thought",
});
const toolGroup = (id: string): Message => ({
  role: "tool-group", id, timestamp: 2, collapsed: true,
  entries: [{ toolCallId: `${id}-ok`, toolName: "read", phase: "done", detail: "result" }],
  summary: { total: 1, success: 1, failed: 0, toolNames: ["read"] },
});

describe("chat view model", () => {
  test("reports the empty conversation", () => {
    expect(buildChatViewModel([])).toEqual({
      isEmpty: true,
      messages: [],
      completedTools: { byAssistantId: new Map(), attachedGroupIds: new Set() },
    });
  });

  test("attaches completed tool groups to the assistant in the same turn", () => {
    const messages = [user(), toolGroup("tools"), assistant("answer")];
    const view = buildChatViewModel(messages);
    expect(view.isEmpty).toBe(false);
    expect(view.messages).toBe(messages);
    expect(view.completedTools.byAssistantId.get("answer")?.map(group => group.id)).toEqual(["tools"]);
    expect([...view.completedTools.attachedGroupIds]).toEqual(["tools"]);
    expect(placeCompletedToolGroups(messages).byAssistantId.size).toBe(1);
  });
});
