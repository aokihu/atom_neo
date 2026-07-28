import { describe, expect, test } from "bun:test";
import { isFailedToolAssistant, isPromptEligibleMessage } from "./message-policy";

describe("session message policy", () => {
  test("drops provider tool-call markup from future model context", () => {
    const message = {
      role: "assistant" as const,
      content: "<｜｜DSML｜｜tool_calls>bad",
      timestamp: 1,
    };
    expect(isFailedToolAssistant(message)).toBe(true);
    expect(isPromptEligibleMessage(message)).toBe(false);
  });

  test("drops incomplete Assistant text backed only by failed tools", () => {
    expect(isFailedToolAssistant({
      role: "assistant",
      content: "我继续搜索",
      metadata: {
        completeDetected: false,
        toolEffectSummary: {
          evidence: 0,
          referenceEvidence: 0,
          stateChanged: 0,
          none: 2,
          failed: 1,
        },
      },
    })).toBe(true);
  });

  test("keeps ordinary and verified Assistant messages as references", () => {
    expect(isFailedToolAssistant({
      role: "assistant",
      content: "普通回答",
      metadata: { completeDetected: false },
    })).toBe(false);
    expect(isFailedToolAssistant({
      role: "assistant",
      content: "已验证回答",
      metadata: {
        completeDetected: false,
        toolEffectSummary: {
          evidence: 1,
          referenceEvidence: 0,
          stateChanged: 0,
          none: 0,
          failed: 1,
        },
      },
    })).toBe(false);
  });
});
