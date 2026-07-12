import { describe, expect, test } from "bun:test";
import { containsExplicitUrl, selectActiveToolsForStep, summarizeMemorySearch, summarizeSkillDiscovery } from "./stream-llm";

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
    memorySearchAttemptCount: 0,
    memorySearchFound: false,
    memorySearchUnavailable: false,
    memorySuggestsSkill: false,
    hasSkillContext: false,
    skillLoaded: false,
    skillUnavailable: false,
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

  test("unlocks webfetch after Memory is found", () => {
    const selection = select({ memorySearchAttemptCount: 1, memorySearchFound: true });

    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchUnlockReason).toBe("memory_found");
  });

  test("requires Skill loading when Memory contains a Skill hint", () => {
    const locked = select({ memorySearchAttemptCount: 1, memorySearchFound: true, memorySuggestsSkill: true });
    const loaded = select({ memorySearchAttemptCount: 1, memorySearchFound: true, memorySuggestsSkill: true, skillLoaded: true });
    const unavailable = select({ memorySearchAttemptCount: 1, memorySearchFound: true, memorySuggestsSkill: true, skillUnavailable: true });

    expect(locked.activeTools).not.toContain("webfetch");
    expect(locked.webfetchUnlockReason).toBe("skill_load_required");
    expect(loaded.webfetchUnlockReason).toBe("skill_context");
    expect(unavailable.webfetchUnlockReason).toBe("skill_unavailable");
  });

  test("keeps webfetch locked after one empty search", () => {
    const selection = select({ memorySearchAttemptCount: 1 });

    expect(selection.activeTools).not.toContain("webfetch");
    expect(selection.webfetchUnlockReason).toBe("memory_search_retry_required");
  });

  test("keeps webfetch locked after two different empty searches", () => {
    const selection = select({ memorySearchAttemptCount: 2 });

    expect(selection.activeTools).not.toContain("webfetch");
    expect(selection.webfetchUnlockReason).toBe("memory_search_retry_required");
  });

  test("unlocks webfetch after three different empty searches", () => {
    const selection = select({ memorySearchAttemptCount: 3 });

    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchUnlockReason).toBe("memory_search_exhausted");
  });

  test("unlocks webfetch when Memory is unavailable", () => {
    const selection = select({ memorySearchAttemptCount: 1, memorySearchUnavailable: true });

    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchUnlockReason).toBe("memory_unavailable");
  });

  test("allows explicit URLs and loaded Skill context to bypass Memory search", () => {
    expect(select({ hasExplicitUrl: true }).webfetchUnlockReason).toBe("explicit_url");
    expect(select({ hasSkillContext: true }).webfetchUnlockReason).toBe("skill_context");
    expect(select({ hasExplicitUrl: true }).activeTools).toContain("webfetch");
    expect(select({ hasSkillContext: true }).activeTools).toContain("webfetch");
  });

  test("makes every Skill tool active for information questions", () => {
    const selection = select({ taskIntent: "question", memorySearchAttemptCount: 1, memorySearchFound: true });

    for (const name of ["skill_list", "skill_load", "skill_section", "skill_remove_section", "skill_unload"]) {
      expect(selection.activeTools).toContain(name);
    }
  });
});

describe("summarizeMemorySearch", () => {
  test("counts only mutually dissimilar queries", () => {
    const sameQuery = summarizeMemorySearch({
      automaticQuery: "台风",
      automaticStatus: "empty",
      steps: [{ toolResults: [
        { toolName: "search_memory", input: { query: "台风 最新 2026" }, output: "No memories found." },
        { toolName: "search_memory", input: { query: "台风查询技能" }, output: "No memories found." },
      ] }],
    });
    const distinctQueries = summarizeMemorySearch({
      automaticQuery: "台风",
      automaticStatus: "empty",
      steps: [{ toolResults: [
        { toolName: "search_memory", input: { query: "热带气旋 typhoon" }, output: "No memories found." },
        { toolName: "search_memory", input: { query: "气象灾害 Skill" }, output: "No memories found." },
      ] }],
    });

    expect(sameQuery.attemptCount).toBe(1);
    expect(distinctQueries.attemptCount).toBe(3);
  });

  test("detects found and unavailable tool results", () => {
    const found = summarizeMemorySearch({
      automaticQuery: "",
      automaticStatus: "not_started",
      steps: [{ toolResults: [{ toolName: "search_memory", input: { query: "台风" }, output: '<Memory id="abc123">method</Memory>' }] }],
    });
    const unavailable = summarizeMemorySearch({
      automaticQuery: "",
      automaticStatus: "not_started",
      steps: [{ toolResults: [{ toolName: "search_memory", input: { query: "台风" }, output: "(memory service not connected)" }] }],
    });

    expect(found.found).toBe(true);
    expect(unavailable.unavailable).toBe(true);
  });

  test("detects Skill hints in Memory results", () => {
    const result = summarizeMemorySearch({
      automaticQuery: "台风",
      automaticStatus: "found",
      automaticSuggestsSkill: true,
      steps: [],
    });
    const toolResult = summarizeMemorySearch({
      automaticQuery: "",
      automaticStatus: "not_started",
      steps: [{ toolResults: [{ toolName: "search_memory", input: { query: "台风" }, output: '<Memory id="abc123">使用 Typhoon Skill</Memory>' }] }],
    });

    expect(result.suggestsSkill).toBe(true);
    expect(toolResult.suggestsSkill).toBe(true);
  });
});

describe("summarizeSkillDiscovery", () => {
  test("detects successful and unavailable Skill loads", () => {
    const loaded = summarizeSkillDiscovery([{ toolResults: [{ toolName: "skill_load", input: { name: "typhoon" }, output: 'Loaded skill "typhoon"\n<skill name="typhoon">...</skill>' }] }]);
    const unavailable = summarizeSkillDiscovery([{ toolResults: [{ toolName: "skill_load", input: { name: "missing" }, output: 'Error: Skill "missing" not found' }] }]);

    expect(loaded.loaded).toBe(true);
    expect(unavailable.unavailable).toBe(true);
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
