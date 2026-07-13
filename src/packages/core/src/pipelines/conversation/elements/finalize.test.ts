import { describe, expect, test } from "bun:test";
import { ContextService } from "../../../context/context-service";
import { SessionContext } from "../../../session/context";
import { makeBus } from "../../../pipelines/test-helpers";
import { FinalizeElement } from "./finalize";

function createFixture(errorStatusCode = 0) {
  const bus = makeBus();
  const contextService = new ContextService(bus, { sweepIntervalMs: 0 });
  contextService.start();
  contextService.put({
    scope: "session",
    owner: { sessionId: "s1" },
    entry: {
      key: "evaluator-suggestion",
      source: "evaluator",
      channel: "instructions",
      trust: "trusted",
      priority: 1,
      consumeOnCommit: true,
      content: "retry",
    },
  });
  const contextSnapshot = contextService.createSnapshot({ sessionId: "s1" });
  const session = new SessionContext("s1");
  const element = new FinalizeElement({ name: "finalize", kind: "sink", bus, session });
  return {
    contextService,
    element,
    input: {
      mode: "ready_to_finalize" as const,
      task: { id: "t1", sessionId: "s1", chatId: "c1" },
      contextSnapshot,
      errorStatusCode,
      contextSnapshotAccepted: errorStatusCode === 0,
    },
  };
}

describe("FinalizeElement context snapshot", () => {
  test("commits one-shot context after a successful model call", async () => {
    const { contextService, element, input } = createFixture();
    await element.doProcess(input);

    expect(contextService.get("session", { sessionId: "s1" }, "evaluator-suggestion")).toBeUndefined();
    expect(contextService.inspectSnapshot(input.contextSnapshot.id)?.status).toBe("committed");
  });

  test("releases the snapshot without consuming context when the model call fails", async () => {
    const { contextService, element, input } = createFixture(500);
    await element.doProcess(input);

    expect(contextService.get("session", { sessionId: "s1" }, "evaluator-suggestion")).toBeDefined();
    expect(contextService.inspectSnapshot(input.contextSnapshot.id)?.status).toBe("released");
  });

  test("releases the snapshot when no model accepted it", async () => {
    const { contextService, element, input } = createFixture();
    input.contextSnapshotAccepted = false;
    await element.doProcess(input);

    expect(contextService.get("session", { sessionId: "s1" }, "evaluator-suggestion")).toBeDefined();
    expect(contextService.inspectSnapshot(input.contextSnapshot.id)?.status).toBe("released");
  });

  test("defers post-check until Task.Completed persists the assistant message", async () => {
    const { element, input } = createFixture();
    const result = await (element as any).doProcess({
      ...input,
      responseText: "done",
      finishReason: "stop",
    });

    expect(result.shouldPostCheck).toBe(true);
    expect(result.chainAction).toBeUndefined();
    expect(result.finishReason).toBe("stop");
  });

  test("returns the chain decision instead of scheduling before persistence", async () => {
    const { element, input } = createFixture();
    const result = await (element as any).doProcess({
      ...input,
      responseText: "partial",
      chainAction: "follow_up",
    });

    expect(result.chainAction).toBe("follow_up");
    expect(result.shouldPostCheck).toBe(false);
  });

  test("does not request a post-check after a non-recoverable error", async () => {
    const { element, input } = createFixture(400);
    const result = await (element as any).doProcess(input);

    expect(result.shouldPostCheck).toBe(false);
  });
});
