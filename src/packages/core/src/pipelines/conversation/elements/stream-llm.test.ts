import { describe, expect, test } from "bun:test";
import { containsExplicitUrl, selectActiveToolsForStep } from "./stream-llm";

const availableToolNames = [
  "read", "write", "search_memory", "save_memory", "forget_memory", "link_memory", "traverse_memory",
  "skill_list", "skill_load", "skill_section", "skill_remove_section", "skill_unload",
  "todowrite", "intent", "webfetch", "bash", "mcp_weather",
];

function select(overrides: Partial<Parameters<typeof selectActiveToolsForStep>[0]> = {}) {
  return selectActiveToolsForStep({
    taskIntent: "conversation",
    availableToolNames,
    mcpToolNames: ["mcp_weather"],
    memorySearchAttempted: false,
    memorySearchCalled: false,
    hasSkillContext: false,
    hasExplicitUrl: false,
    ...overrides,
  });
}

describe("selectActiveToolsForStep", () => {
  test("keeps Memory and Skill discovery active while webfetch is locked", () => {
    const selection = select();

    expect(selection.activeTools).toContain("search_memory");
    expect(selection.activeTools).toContain("skill_load");
    expect(selection.activeTools).toContain("skill_section");
    expect(selection.activeTools).toContain("mcp_weather");
    expect(selection.activeTools).not.toContain("webfetch");
    expect(selection.webfetchUnlockReason).toBe("memory_search_required");
  });

  test("unlocks webfetch after automatic Memory search", () => {
    const selection = select({ memorySearchAttempted: true });

    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchUnlockReason).toBe("automatic_memory_search");
  });

  test("unlocks webfetch on the step after search_memory is called", () => {
    const selection = select({ memorySearchCalled: true });

    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchUnlockReason).toBe("search_memory_called");
  });

  test("allows explicit URLs and loaded Skill context to bypass Memory search", () => {
    expect(select({ hasExplicitUrl: true }).webfetchUnlockReason).toBe("explicit_url");
    expect(select({ hasSkillContext: true }).webfetchUnlockReason).toBe("skill_context");
    expect(select({ hasExplicitUrl: true }).activeTools).toContain("webfetch");
    expect(select({ hasSkillContext: true }).activeTools).toContain("webfetch");
  });

  test("makes every Skill tool active for information questions", () => {
    const selection = select({ taskIntent: "question", memorySearchAttempted: true });

    for (const name of ["skill_list", "skill_load", "skill_section", "skill_remove_section", "skill_unload"]) {
      expect(selection.activeTools).toContain(name);
    }
  });
});

describe("containsExplicitUrl", () => {
  test("checks only the latest user message", () => {
    expect(containsExplicitUrl([
      { role: "user", content: "https://old.example.com" },
      { role: "assistant", content: "done" },
      { role: "user", content: "查一下台风" },
    ])).toBe(false);
    expect(containsExplicitUrl([
      { role: "user", content: "查一下 https://typhoon.example.com" },
    ])).toBe(true);
  });
});
