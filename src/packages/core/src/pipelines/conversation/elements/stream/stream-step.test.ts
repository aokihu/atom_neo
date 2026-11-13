import { describe, expect, test } from "bun:test";
import { consumeStreamChunk, resolveTimeout } from "./stream-step";

const state = { stepNumber: 3, callCount: 1, reasoningOffset: 12 };

describe("stream chunk classification", () => {
  test("classifies reasoning with the running transport offset", () => {
    expect(consumeStreamChunk({ type: "reasoning-delta", textDelta: "think" }, state))
      .toEqual({ kind: "reasoning", text: "think", offset: 12 });
    expect(consumeStreamChunk({ type: "reasoning", text: "legacy" }, state))
      .toEqual({ kind: "reasoning", text: "legacy", offset: 12 });
    expect(consumeStreamChunk({ type: "reasoning-delta", textDelta: "" }, state))
      .toEqual({ kind: "ignore" });
  });

  test("keeps empty text deltas observable", () => {
    expect(consumeStreamChunk({ type: "text-delta", text: "" }, state))
      .toEqual({ kind: "text", text: "" });
    expect(consumeStreamChunk({ type: "text-delta", text: "body" }, state))
      .toEqual({ kind: "text", text: "body" });
  });

  test("classifies tool calls and preserves the manual fallback id", () => {
    expect(consumeStreamChunk({
      type: "tool-call", toolCallId: "call-1", toolName: "probe", input: { value: "x" },
    }, state)).toEqual({
      kind: "tool-call",
      call: { toolCallId: "call-1", toolName: "probe", input: { value: "x" } },
    });
    expect(consumeStreamChunk({ type: "tool-call", toolName: "probe", args: { value: "x" } }, state))
      .toEqual({
        kind: "tool-call",
        call: { toolCallId: "manual-3-1", toolName: "probe", input: { value: "x" } },
      });
  });

  test("classifies finish, error status, abort, and unknown parts", () => {
    expect(consumeStreamChunk({ type: "finish", finishReason: "length" }, state))
      .toEqual({ kind: "finish", finishReason: "length" });
    expect(consumeStreamChunk({ type: "finish-step" }, state))
      .toEqual({ kind: "finish", finishReason: undefined });

    const error = { name: "AI_APICallError", statusCode: 400, message: "offline", responseBody: "{}" };
    expect(consumeStreamChunk({ type: "error", error }, state))
      .toEqual({ kind: "error", statusCode: 400, error });
    expect(consumeStreamChunk({ type: "error" }, state))
      .toEqual({ kind: "error", statusCode: undefined, error: {} });

    expect(consumeStreamChunk({ type: "abort" }, state)).toEqual({ kind: "abort" });
    expect(consumeStreamChunk({ type: "metadata" }, state)).toEqual({ kind: "ignore" });
  });
});

describe("stream timeout", () => {
  test("keeps the difficulty timeout table", () => {
    expect(resolveTimeout("mygod")).toBe(1_800_000);
    expect(resolveTimeout("hard")).toBe(900_000);
    expect(resolveTimeout("medium")).toBe(600_000);
    expect(resolveTimeout("easy")).toBe(300_000);
  });
});
