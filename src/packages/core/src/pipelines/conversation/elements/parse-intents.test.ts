import { describe, test, expect } from "bun:test";
import { parseIntentRequests } from "./index";
import { IntentRequestType } from "@atom-neo/shared";

describe("parseIntentRequests", () => {
  test("parses REQUEST_MORE_TOOLS", () => {
    const intents = parseIntentRequests("[REQUEST_MORE_TOOLS]");
    expect(intents).toHaveLength(1);
    expect(intents[0].request).toBe(IntentRequestType.REQUEST_MORE_TOOLS);
  });

  test("parses KEEP_MEMORY with mem_id", () => {
    const intents = parseIntentRequests("[KEEP_MEMORY,mem_id=abc123]");
    expect(intents).toHaveLength(1);
    expect(intents[0].request).toBe(IntentRequestType.KEEP_MEMORY);
    expect(intents[0].params.id).toBe("abc123");
  });

  test("skips KEEP_MEMORY without mem_id", () => {
    const intents = parseIntentRequests("[KEEP_MEMORY]");
    expect(intents).toHaveLength(0);
  });

  test("parses FOLLOW_UP with next_prompt", () => {
    const intents = parseIntentRequests("[FOLLOW_UP,next_prompt=继续]");
    expect(intents).toHaveLength(1);
    expect(intents[0].request).toBe(IntentRequestType.FOLLOW_UP);
  });

  test("parses FOLLOW_UP with history_abstract", () => {
    const intents = parseIntentRequests("[FOLLOW_UP,history_abstract=前文摘要]");
    expect(intents).toHaveLength(1);
    expect(intents[0].request).toBe(IntentRequestType.FOLLOW_UP);
  });

  test("parses FOLLOW_UP with summary", () => {
    const intents = parseIntentRequests("[FOLLOW_UP,summary=摘要]");
    expect(intents).toHaveLength(1);
  });

  test("skips FOLLOW_UP without any meaningful param", () => {
    const intents = parseIntentRequests("[FOLLOW_UP]");
    expect(intents).toHaveLength(0);
  });

  test("ignores unknown TYPE", () => {
    const intents = parseIntentRequests("[UNKNOWN_TYPE]");
    expect(intents).toHaveLength(0);
  });

  test("parses multiple intents", () => {
    const intents = parseIntentRequests("[REQUEST_MORE_TOOLS][KEEP_MEMORY,mem_id=xyz]");
    expect(intents).toHaveLength(2);
    expect(intents[0].request).toBe(IntentRequestType.REQUEST_MORE_TOOLS);
    expect(intents[1].request).toBe(IntentRequestType.KEEP_MEMORY);
  });

  test("mixed valid and invalid intents", () => {
    const intents = parseIntentRequests("[UNKNOWN_TYPE][REQUEST_MORE_TOOLS][FOLLOW_UP]");
    expect(intents).toHaveLength(1); // UNKNOWN_TYPE skipped, FOLLOW_UP skipped (no params), only REQUEST_MORE_TOOLS
  });

  test("empty text returns empty array", () => {
    expect(parseIntentRequests("")).toHaveLength(0);
    expect(parseIntentRequests("no brackets here")).toHaveLength(0);
  });
});
