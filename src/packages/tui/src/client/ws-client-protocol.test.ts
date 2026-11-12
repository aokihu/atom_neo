import { describe, expect, test } from "bun:test";
import { TaskFailureCodes, WsMessages } from "@atom-neo/shared";
import { parseServerEvent, TuiTaskError } from "./ws-client-protocol";

describe("ws client protocol", () => {
  test("parses known server events and preserves the raw payload", () => {
    expect(parseServerEvent({ type: WsMessages.Server.TaskCompleted, payload: { taskId: "t" } }))
      .toEqual({ type: WsMessages.Server.TaskCompleted, payload: { taskId: "t" } } as any);
    expect(parseServerEvent({ type: WsMessages.Server.SessionReady, payload: {} }))
      .toEqual({ type: WsMessages.Server.SessionReady, payload: {} } as any);
  });

  test("rejects malformed or unknown frames", () => {
    expect(parseServerEvent(null)).toBeNull();
    expect(parseServerEvent(undefined)).toBeNull();
    expect(parseServerEvent("event")).toBeNull();
    expect(parseServerEvent({})).toBeNull();
    expect(parseServerEvent({ type: "event.unknown", payload: {} })).toBeNull();
    expect(parseServerEvent({ type: 42, payload: {} })).toBeNull();
  });

  test("keeps the cancellation and API key error names", () => {
    const cancelled = new TuiTaskError("Task cancelled by user", TaskFailureCodes.PipelineAborted);
    expect(cancelled.name).toBe("TaskCancelledError");
    expect(cancelled.code).toBe(TaskFailureCodes.PipelineAborted);

    const apiKey = new TuiTaskError("rejected", TaskFailureCodes.ApiKeyInvalid);
    expect(apiKey.name).toBe("ApiKeyInvalidError");

    const other = new TuiTaskError("failed");
    expect(other.name).toBe("Error");
    expect(other.code).toBeUndefined();
  });
});
