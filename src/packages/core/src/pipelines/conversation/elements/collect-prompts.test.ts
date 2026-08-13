import { describe, expect, test } from "bun:test";
import { selectPromptMessages } from "./collect-prompts";

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
