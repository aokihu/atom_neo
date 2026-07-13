import { describe, expect, test } from "bun:test";
import { buildAssistantReview } from "./collect-input";

describe("buildAssistantReview", () => {
  test("keeps a short response unchanged", () => {
    const review = buildAssistantReview([{ content: "short answer" }]);

    expect(review.response).toBe("short answer");
    expect(review.assistantLength).toBe(12);
    expect(review.activeTodoCount).toBe(0);
  });

  test("keeps the head, tail, TODO state, and finish metadata for long output", () => {
    const review = buildAssistantReview([
      { content: `HEAD-${"a".repeat(1600)}` },
      {
        content: `${"b".repeat(1800)}-TAIL`,
        metadata: { finishReason: "stop", completeDetected: false },
      },
    ], [
      { content: "chapter 1", status: "completed", priority: "high" },
      { content: "chapter 2", status: "in_progress", priority: "high" },
      { content: "chapter 3", status: "pending", priority: "high" },
    ]);

    expect(review.response).toContain("HEAD-");
    expect(review.response).toContain("-TAIL");
    expect(review.response).toContain("completed=1");
    expect(review.response).toContain("in_progress=1");
    expect(review.response).toContain("pending=1");
    expect(review.response).toContain("finishReason=stop");
    expect(review.activeTodoCount).toBe(2);
    expect(review.completeDetected).toBe(false);
    expect(review.response.length).toBeLessThan(3000);
  });
});
