import { describe, expect, test } from "bun:test";
import { IntentRequestType } from "@atom-neo/shared";
import { makeBus } from "../../test-helpers";
import { CheckFollowUpElement } from "./check-follow-up";

function createElement(todoState: any[] = []) {
  return new CheckFollowUpElement({
    name: "check-follow-up",
    kind: "boundary",
    bus: makeBus(),
    session: { todoState },
  });
}

describe("CheckFollowUpElement", () => {
  test("continues the TODO plan while a TODO is still active", async () => {
    const element = createElement([
      { content: "chapter 1", status: "completed", priority: "high" },
      { content: "chapter 2", status: "in_progress", priority: "high" },
      { content: "chapter 3", status: "pending", priority: "high" },
    ]);

    const result = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [],
    });

    expect(result.chainAction).toBe("continue_todo");
  });

  test("allows completion after every TODO is terminal", async () => {
    const element = createElement([
      { content: "chapter 1", status: "completed", priority: "high" },
      { content: "chapter 2", status: "cancelled", priority: "low" },
    ]);

    const result = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [],
    });

    expect(result.chainAction).toBeUndefined();
  });

  test("preserves explicit and stream-level follow-up decisions", async () => {
    const element = createElement();
    const explicit = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [{ request: IntentRequestType.FOLLOW_UP, params: { summary: "next" } }],
    });
    const stream = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [],
      chainAction: "follow_up",
    });

    expect(explicit.chainAction).toBe("follow_up");
    expect(stream.chainAction).toBe("follow_up");
  });

  test("keeps stream follow-up ahead of active TODO continuation", async () => {
    const element = createElement([
      { content: "chapter 2", status: "in_progress", priority: "high" },
    ]);

    const result = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [],
      chainAction: "follow_up",
    });

    expect(result.chainAction).toBe("follow_up");
  });

  test("does not loop active TODOs after a non-recoverable request error", async () => {
    const element = createElement([
      { content: "chapter 2", status: "in_progress", priority: "high" },
    ]);

    const result = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [],
      errorStatusCode: 400,
    });

    expect(result.chainAction).toBeUndefined();
  });

  test("does not preserve explicit follow-up after a non-recoverable request error", async () => {
    const element = createElement();

    const result = await (element as any).doProcess({
      mode: "executing",
      task: {},
      intents: [{ request: IntentRequestType.FOLLOW_UP, params: { summary: "next" } }],
      errorStatusCode: 400,
    });

    expect(result.chainAction).toBeUndefined();
  });
});
