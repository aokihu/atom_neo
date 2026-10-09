import { beforeAll, describe, expect, test } from "bun:test";
import { BusEvents, initPromptRegistry } from "@atom-neo/shared";
import { ContextService } from "../../../context/context-service";
import { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import { makeBus } from "../../test-helpers";
import { CollectInputElement } from "./collect-input";
import { PostConversationFinalizeElement } from "./finalize";
import { FALLBACK_ANALYSIS } from "./types";

beforeAll(initPromptRegistry);

describe("PostConversationFinalizeElement", () => {
  test("only confirmed completion reports the reviewed goal; fallback and conflict do not", async () => {
    const bus = makeBus();
    const contextService = new ContextService(bus, { sweepIntervalMs: 0 });
    const element = new PostConversationFinalizeElement({ name: "post-finalize", kind: "sink", bus, contextService });
    const base = { mode: "acting", task: { id: "post" }, session: { originalSource: "external" }, executionGoalId: "reviewed-goal" };
    const result = await element.doProcess({ ...base, analysis: { status: "satisfactory", confirmed: true, reason: "requirements_met", assessment: { contentState: "complete" } } } as any);
    expect(result).toHaveProperty("completedGoalId", "reviewed-goal");
    for (const analysis of [FALLBACK_ANALYSIS, undefined,
      { status: "satisfactory", reason: "unconfirmed" },
      { status: "satisfactory", confirmed: true, reason: "conflict", assessment: { contentState: "unfinished" } },
      { status: "blocked", confirmed: true, reason: "blocked" },
      { status: "needs_user_input", confirmed: true, reason: "question" }]) {
      expect(await element.doProcess({ ...base, analysis } as any)).not.toHaveProperty("completedGoalId");
    }
  });
  test("records retry guidance in topic context", async () => {
    const bus = makeBus();
    const contextService = new ContextService(bus, { sweepIntervalMs: 0 });
    contextService.start();
    const element = new PostConversationFinalizeElement({
      name: "post-finalize",
      kind: "sink",
      bus,
      contextService,
    });
    const session = {
      sessionId: "s1",
      currentTopic: "topic-a",
      originalSource: "internal",
      postCheckFingerprints: [],
      addPostCheckFingerprint: () => {},
    };

    await (element as any).doProcess({
      mode: "finalizing",
      task: { id: "t1", chatId: "c1" },
      session,
      analysis: { status: "blocked", reason: "retry", fingerprint: "first" },
    });

    const guidance = contextService.get(
      "topic",
      { sessionId: "s1", topicId: "topic-a" },
      "post-check-guidance",
    );
    expect(guidance?.consumeOnCommit).toBe(true);
    expect(guidance?.channel).toBe("messages");
    expect(guidance?.trust).toBe("untrusted");
  });

  test("preserves the source task and stages retry until it commits", async () => {
    const bus = makeBus();
    const tasks: any[] = [];
    const orchestrator = new InternalTaskOrchestrator({ enqueue: (task: any) => tasks.push(task) } as any, bus);
    bus.on(BusEvents.Conversation.Chain as any, (event: any) => {
      const payload = event.payload;
      orchestrator.scheduleFollowUp(
        payload.sessionId,
        payload.chatId,
        payload.parentTaskId,
        payload.ownerTaskId,
      );
    });
    const contextService = new ContextService(bus, { sweepIntervalMs: 0 });
    contextService.start();
    const session = {
      sessionId: "s1",
      currentTopic: null,
      originalSource: "internal",
      postCheckFingerprints: [],
      addPostCheckFingerprint: () => {},
      todoState: [],
      messages: [
        { role: "user", content: "do it" },
        { role: "assistant", content: "not done", visible: true },
      ],
    };
    const task = { id: "post-1", chainId: "root-1", parentTaskId: "root-1", chatId: "c1" };
    orchestrator.beginTask(task as any);
    const collect = new CollectInputElement({ name: "post-collect", kind: "source", bus, session });
    const finalize = new PostConversationFinalizeElement({
      name: "post-finalize",
      kind: "sink",
      bus,
      contextService,
    });

    const collected = await collect.process({ mode: "initial", task, session } as any);
    await finalize.process({
      ...collected,
      mode: "acting",
      analysis: { status: "blocked", reason: "retry", fingerprint: "first" },
    });

    expect(tasks).toHaveLength(0);
    orchestrator.commitTask(task.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].chainId).toBe("root-1");
    expect(tasks[0].parentTaskId).toBe("root-1");
  });
});
