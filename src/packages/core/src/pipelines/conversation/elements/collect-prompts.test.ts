import { describe, expect, test } from "bun:test";
import { makeBus } from "@core/pipelines/test-helpers";
import { CollectPromptsElement, selectPromptMessages } from "./collect-prompts";

const messages = [
  { role: "user", content: "杭州天气" },
  { role: "assistant", content: "天气回答" },
  { role: "user", content: "浙江工业大学有游泳馆吗" },
  { role: "assistant", content: "浙工大回答" },
  { role: "user", content: "浙江大学呢" },
];

describe("selectPromptMessages", () => {
  test("keeps only the current user request for standalone tasks", () => {
    expect(selectPromptMessages(messages, "standalone")).toEqual([messages[4]!]);
  });

  test("keeps only the previous exchange and current user for follow-ups", () => {
    expect(selectPromptMessages(messages, "follow_up")).toEqual(messages.slice(-3));
  });

  test("keeps full history only for explicit continuation", () => {
    expect(selectPromptMessages(messages, "continuation")).toEqual(messages);
  });
});

describe("CollectPromptsElement", () => {
  test("projects visible session messages and keeps assistant reasoning", async () => {
    const session = {
      messages: [
        { role: "user", content: "写世界文明史", timestamp: 1 },
        { role: "assistant", content: "第一段", reasoningContent: "thinking", timestamp: 2 },
        { role: "assistant", content: "hidden", timestamp: 3, visible: false },
      ],
    };
    const element = new CollectPromptsElement({
      name: "collect-prompts",
      kind: "source",
      bus: makeBus(),
      session: session as any,
      contextRelevance: "continuation",
    });

    const result = await element.doProcess({ mode: "initial", task: { id: "t1" } } as any);

    expect(result.prompts).toEqual([
      { role: "user", content: "写世界文明史" },
      { role: "assistant", content: "第一段", reasoning_content: "thinking" },
    ]);
  });
});
