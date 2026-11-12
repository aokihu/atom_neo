import { describe, expect, test } from "bun:test";
import {
  appendCurrentUserMessage,
  projectPipelineMessage,
  selectPromptEligibleMessages,
} from "./message-projection";

describe("appendCurrentUserMessage", () => {
  test("returns a new array and leaves the input untouched", () => {
    const input = [{ role: "assistant", content: "previous answer" }];
    const result = appendCurrentUserMessage(input, "current request");

    expect(result).toEqual([
      { role: "assistant", content: "previous answer" },
      { role: "user", content: "current request" },
    ]);
    expect(result).not.toBe(input);
    expect(input).toEqual([{ role: "assistant", content: "previous answer" }]);
  });

  test("returns a fresh array even when nothing is appended", () => {
    const input = [{ role: "user", content: "current request" }];

    expect(appendCurrentUserMessage(input, "current request")).toEqual(input);
    expect(appendCurrentUserMessage(input)).toEqual(input);
    expect(appendCurrentUserMessage([], "")).toEqual([]);
    expect(appendCurrentUserMessage([], "current request")).toEqual([
      { role: "user", content: "current request" },
    ]);
  });

  test("does not duplicate a trailing user message with different content rules", () => {
    const input = [{ role: "assistant", content: "answer" }];
    expect(appendCurrentUserMessage(input, "first")).toEqual([
      { role: "assistant", content: "answer" },
      { role: "user", content: "first" },
    ]);
    expect(appendCurrentUserMessage(appendCurrentUserMessage(input, "first"), "second")).toEqual([
      { role: "assistant", content: "answer" },
      { role: "user", content: "first" },
      { role: "user", content: "second" },
    ]);
  });
});

describe("projectPipelineMessage", () => {
  test("keeps reasoning_content by default from either input field", () => {
    expect(projectPipelineMessage({
      role: "assistant",
      content: "第一段",
      reasoningContent: "thinking",
    })).toEqual({ role: "assistant", content: "第一段", reasoning_content: "thinking" });
    expect(projectPipelineMessage({
      role: "assistant",
      content: "第二段",
      reasoning_content: "more thinking",
    })).toEqual({ role: "assistant", content: "第二段", reasoning_content: "more thinking" });
  });

  test("drops reasoning when requested, empty, or absent", () => {
    expect(projectPipelineMessage(
      { role: "assistant", content: "第一段", reasoning_content: "thinking" },
      { keepReasoning: false },
    )).toEqual({ role: "assistant", content: "第一段" });
    expect(projectPipelineMessage({ role: "assistant", content: "第一段", reasoningContent: "" }))
      .toEqual({ role: "assistant", content: "第一段" });
    expect(projectPipelineMessage({ role: "user", content: "current request" }))
      .toEqual({ role: "user", content: "current request" });
  });
});

describe("selectPromptEligibleMessages", () => {
  test("reuses message-policy visibility and failed-tool filtering", () => {
    const messages = [
      { role: "user" as const, content: "visible user", timestamp: 1 },
      { role: "assistant" as const, content: "hidden", timestamp: 2, visible: false },
      {
        role: "assistant" as const,
        content: "failed tools",
        timestamp: 3,
        metadata: {
          completeDetected: false,
          toolEffectSummary: {
            evidence: 0,
            referenceEvidence: 0,
            stateChanged: 0,
            none: 1,
            failed: 1,
          },
        },
      },
      { role: "assistant" as const, content: "kept", timestamp: 4 },
    ];

    expect(selectPromptEligibleMessages(messages).map(message => message.content))
      .toEqual(["visible user", "kept"]);
  });
});
