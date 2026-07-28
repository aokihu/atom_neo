import { describe, expect, test } from "bun:test";
import { PromptKey } from "./keys";
import { enBases } from "./variants/lang/en";
import { zhBases } from "./variants/lang/zh";

describe("Memory discovery prompts", () => {
  test("Prediction retains classification fields without Memory or Tool instructions", () => {
    for (const prompt of [
      zhBases[PromptKey.PREDICT_INTENT],
      enBases[PromptKey.PREDICT_INTENT],
    ]) {
      expect(prompt).toContain('"modelProfile"');
      expect(prompt).toContain('"contextRelevance"');
      expect(prompt).toContain('"topic"');
      expect(prompt).toContain('"reasoning"');
      expect(prompt).not.toContain("memory_query");
      expect(prompt).not.toContain("search_memory");
    }
  });

  test("base prompts keep all tools available and leave Tool selection to Conversation", () => {
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("`skill_list`");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("`skill_list`");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("All tools remain available");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("所有工具始终可用");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("framework does not choose");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("框架不会替你选择");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("Before using `webfetch`, query both Memory and Skills");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("使用 `webfetch` 前必须先查询 Memory 和 Skill");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("Only adjust the query");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("只有存在实质不同的检索概念");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("read_memory");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("read_memory");
    expect(zhBases[PromptKey.BASE_SYSTEM]).not.toContain("ToolGuard");
    expect(enBases[PromptKey.BASE_SYSTEM]).not.toContain("ToolGuard");
  });

  test("base prompts keep traversal summary-only and replace memories atomically", () => {
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("`traverse_memory`");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("`relatedCount`");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("`supersedesId`");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("原子完成");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("`traverse_memory`");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("`relatedCount`");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("`supersedesId`");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("replacement are atomic");
  });

  test("result analysis checks long-response tails and active TODOs", () => {
    expect(zhBases[PromptKey.ANALYZE_RESULT]).toContain("Response Head 与 Response Tail");
    expect(zhBases[PromptKey.ANALYZE_RESULT]).toContain("pending/in_progress");
    expect(enBases[PromptKey.ANALYZE_RESULT]).toContain("Response Head and Response Tail");
    expect(enBases[PromptKey.ANALYZE_RESULT]).toContain("pending/in_progress");
  });
});

describe("Continuation prompts", () => {
  test("keeps TODO progression separate from follow-up in both languages", () => {
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("系统会根据 active TODO 自动进入下一项");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("system continues from the active TODO");
    expect(zhBases[PromptKey.BASE_SYSTEM]).not.toContain("`todowrite` → `intent`");
    expect(enBases[PromptKey.BASE_SYSTEM]).not.toContain("`todowrite` → `intent`");
    expect(zhBases[PromptKey.CONTEXT_DIFFICULTY_RULES]).not.toContain("action: follow_up");
    expect(enBases[PromptKey.CONTEXT_DIFFICULTY_RULES]).not.toContain("action: follow_up");
  });
});
