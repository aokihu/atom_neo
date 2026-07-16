import { describe, expect, test } from "bun:test";
import { PromptKey } from "./keys";
import { enBases } from "./variants/lang/en";
import { zhBases } from "./variants/lang/zh";

describe("Memory discovery prompts", () => {
  test("Prediction requests a core memory_query in both languages", () => {
    expect(zhBases[PromptKey.PREDICT_INTENT]).toContain('"memory_query":"..."');
    expect(zhBases[PromptKey.PREDICT_INTENT]).toContain("台风");
    expect(enBases[PromptKey.PREDICT_INTENT]).toContain('"memory_query":"..."');
    expect(enBases[PromptKey.PREDICT_INTENT]).toContain("typhoon");
  });

  test("base prompts require Memory discovery before webfetch", () => {
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("实时数据也不能跳过能力发现");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("real-time data does not bypass capability discovery");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("ToolGuard");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("ToolGuard");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("`skill_list`");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("`skill_list`");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("always visible");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("read_memory");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("read_memory");
  });

  test("base prompts keep traversal summary-only and replace memories atomically", () => {
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("`traverse_memory`");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("`supersedesId`");
    expect(zhBases[PromptKey.BASE_SYSTEM]).toContain("原子完成");
    expect(enBases[PromptKey.BASE_SYSTEM]).toContain("`traverse_memory`");
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
