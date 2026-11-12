import { describe, expect, test } from "bun:test";
import { makeBus } from "../../test-helpers";
import { FormatUserMessagesElement } from "./format-user-messages";

describe("FormatUserMessagesElement", () => {
  test("drops prompt reasoning and appends the current text payload once", async () => {
    const prompts = [
      { role: "assistant", content: "previous answer", reasoning_content: "thinking" },
      { role: "tool", content: "tool output" },
    ];
    const element = new FormatUserMessagesElement({
      name: "format-user-messages",
      kind: "transform",
      bus: makeBus(),
    });

    const result = await element.doProcess({
      mode: "streaming",
      task: { payload: [{ type: "text", data: "current request" }] },
      prompts,
    } as any);

    expect(result.userMessages).toEqual([
      { role: "assistant", content: "previous answer" },
      { role: "user", content: "current request" },
    ]);
    expect(prompts).toEqual([
      { role: "assistant", content: "previous answer", reasoning_content: "thinking" },
      { role: "tool", content: "tool output" },
    ]);
  });
});
