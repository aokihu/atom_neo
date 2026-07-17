import { beforeEach, describe, expect, test } from "bun:test";
import { useChatStore } from "./chat";

describe("chat store task completion", () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      toolGroupId: null,
      activeAssistantId: null,
      busy: false,
      showPreparing: false,
    });
  });

  test("clears the preparing spinner when the task is no longer busy", () => {
    useChatStore.getState().prepareForSend();
    expect(useChatStore.getState()).toMatchObject({ busy: true, showPreparing: true });

    useChatStore.getState().setBusy(false);
    expect(useChatStore.getState()).toMatchObject({ busy: false, showPreparing: false });
  });

  test("removes only the transient message after its duration", async () => {
    const persistent = { role: "info" as const, content: "keep", id: "keep", timestamp: Date.now() };
    const transient = { role: "info" as const, content: "hide", id: "hide", timestamp: Date.now() };
    useChatStore.getState().addMessage(persistent);
    useChatStore.getState().addTransientMessage(transient, 10);

    expect(useChatStore.getState().messages).toEqual([persistent, transient]);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(useChatStore.getState().messages).toEqual([persistent]);
  });

  test("uses result and error to finish tool entries", () => {
    useChatStore.getState().handleToolEvent({ name: "weather", callId: "success", input: {} });
    useChatStore.getState().handleToolEvent({ name: "weather", callId: "success", result: "sunny" });
    useChatStore.getState().handleToolEvent({ name: "weather", callId: "failure", input: {} });
    useChatStore.getState().handleToolEvent({ name: "weather", callId: "failure", error: "offline" });

    const group = useChatStore.getState().messages[0];
    expect(group).toMatchObject({
      role: "tool-group",
      entries: [
        { toolCallId: "success", phase: "done", detail: "sunny" },
        { toolCallId: "failure", phase: "error", detail: "offline" },
      ],
    });
  });
});
