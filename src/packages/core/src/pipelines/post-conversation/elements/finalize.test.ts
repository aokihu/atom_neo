import { beforeAll, describe, expect, test } from "bun:test";
import { initPromptRegistry } from "@atom-neo/shared";
import { ContextService } from "../../../context/context-service";
import { makeBus } from "../../test-helpers";
import { PostConversationFinalizeElement } from "./finalize";

beforeAll(initPromptRegistry);

describe("PostConversationFinalizeElement", () => {
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
    expect(guidance?.channel).toBe("instructions");
  });
});
