import { describe, expect, test } from "bun:test";
import { decode } from "@toon-format/toon";
import {
  containsExplicitUrl,
  injectToolContext,
  pruneConsumedTransientTools,
  resolveModelInput,
  selectActiveToolsForStep,
  shouldPersistToolResult,
  summarizeMemoryRead,
  summarizeMemorySearch,
  summarizeSkillDiscovery,
} from "./stream-llm";
import { ContextService } from "../../../context/context-service";
import { makeBus } from "../../test-helpers";

const availableToolNames = [
  "read", "write", "search_memory", "read_memory", "save_memory", "forget_memory", "link_memory", "traverse_memory",
  "skill_list", "skill_load", "skill_section", "skill_remove_section", "skill_unload",
  "todowrite", "intent", "webfetch", "bash", "search_history", "read_history", "mcp_weather",
];

test("uses the TOON Snapshot only as system text", () => {
  const userMessages = [{ role: "user", content: "current request" }];

  expect(resolveModelInput({
    contextSnapshot: { id: "snapshot-1", content: "context[1]{content}:\n  workspace rules" },
    systemText: "legacy system",
    userMessages,
  })).toEqual({
    systemText: "context[1]{content}:\n  workspace rules",
    userMessages,
  });
});

function select(overrides: Partial<Parameters<typeof selectActiveToolsForStep>[0]> = {}) {
  return selectActiveToolsForStep({
    taskIntent: "conversation",
    availableToolNames,
    mcpToolNames: ["mcp_weather"],
    memorySearchAttemptCount: 0,
    memorySearchFound: false,
    memorySearchUnavailable: false,
    memoryRead: false,
    memoryReadUnavailable: false,
    memorySuggestsSkill: false,
    hasSkillContext: false,
    skillChecked: false,
    skillLoaded: false,
    skillUnavailable: false,
    hasExplicitUrl: false,
    ...overrides,
  });
}

describe("selectActiveToolsForStep", () => {
  test("keeps webfetch visible while its guard requires Memory discovery", () => {
    const selection = select();

    expect(selection.activeTools).toContain("search_memory");
    expect(selection.activeTools).toContain("read_memory");
    expect(selection.activeTools).toContain("skill_load");
    expect(selection.activeTools).toContain("skill_section");
    expect(selection.activeTools).toContain("mcp_weather");
    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchAllowed).toBe(false);
    expect(selection.webfetchGuardReason).toBe("memory_search_required");
    expect(selection.webfetchGuardMessage).toContain("search_memory");
  });

  test("keeps webfetch visible and asks the Agent to review a Memory candidate", () => {
    const selection = select({ memorySearchAttemptCount: 1, memorySearchFound: true });

    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchAllowed).toBe(false);
    expect(selection.webfetchGuardReason).toBe("memory_review_required");
    expect(selection.webfetchGuardMessage).toContain("read_memory");
  });

  test("unlocks webfetch after the selected Memory is read", () => {
    const selection = select({ memorySearchAttemptCount: 1, memorySearchFound: true, memoryRead: true });

    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchAllowed).toBe(true);
    expect(selection.webfetchGuardReason).toBe("memory_found");
  });

  test("requires Skill loading when Memory contains a Skill hint", () => {
    const locked = select({ memorySearchAttemptCount: 1, memorySearchFound: true, memoryRead: true, memorySuggestsSkill: true });
    const loaded = select({ memorySearchAttemptCount: 1, memorySearchFound: true, memoryRead: true, memorySuggestsSkill: true, skillLoaded: true });
    const unavailable = select({ memorySearchAttemptCount: 1, memorySearchFound: true, memoryRead: true, memorySuggestsSkill: true, skillUnavailable: true });

    expect(locked.activeTools).toContain("webfetch");
    expect(locked.webfetchAllowed).toBe(false);
    expect(locked.webfetchGuardReason).toBe("skill_load_required");
    expect(loaded.webfetchGuardReason).toBe("skill_context");
    expect(unavailable.webfetchGuardReason).toBe("skill_unavailable");
  });

  test("asks for Skill discovery after one empty Memory search", () => {
    const selection = select({ memorySearchAttemptCount: 1 });

    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchAllowed).toBe(false);
    expect(selection.webfetchGuardReason).toBe("skill_search_required");
    expect(selection.webfetchGuardMessage).toContain("skill_list");
  });

  test("allows webfetch after Memory and Skill discovery complete", () => {
    const selection = select({ memorySearchAttemptCount: 1, skillChecked: true });

    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchAllowed).toBe(true);
    expect(selection.webfetchGuardReason).toBe("capability_discovery_complete");
  });

  test("does not use repeated Memory searches as a Skill-discovery substitute", () => {
    const selection = select({ memorySearchAttemptCount: 3 });

    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchAllowed).toBe(false);
    expect(selection.webfetchGuardReason).toBe("skill_search_required");
  });

  test("lets the Agent dismiss an irrelevant Memory candidate by checking Skills", () => {
    const selection = select({ memorySearchAttemptCount: 3, memorySearchFound: true, skillChecked: true });

    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchAllowed).toBe(true);
    expect(selection.webfetchGuardReason).toBe("capability_discovery_complete");
  });

  test("unlocks webfetch when Memory is unavailable", () => {
    const selection = select({ memorySearchAttemptCount: 1, memorySearchUnavailable: true });

    expect(selection.activeTools).toContain("webfetch");
    expect(selection.webfetchAllowed).toBe(true);
    expect(selection.webfetchGuardReason).toBe("memory_unavailable");
  });

  test("allows explicit URLs and loaded Skill context to bypass Memory search", () => {
    expect(select({ hasExplicitUrl: true }).webfetchGuardReason).toBe("explicit_url");
    expect(select({ hasSkillContext: true }).webfetchGuardReason).toBe("skill_context");
    expect(select({ hasExplicitUrl: true }).activeTools).toContain("webfetch");
    expect(select({ hasSkillContext: true }).activeTools).toContain("webfetch");
  });

  test("keeps webfetch visible for every intent", () => {
    for (const taskIntent of ["conversation", "question", "creative", "instruction"]) {
      const activeTools = select({ taskIntent }).activeTools;
      expect(activeTools).toContain("webfetch");
      expect(activeTools).toContain("search_history");
      expect(activeTools).toContain("read_history");
    }
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
      steps: [{ toolResults: [{ toolName: "search_memory", input: { query: "台风" }, output: '<MemorySummary id="abc123">method</MemorySummary>' }] }],
    });
    const unavailable = summarizeMemorySearch({
      automaticQuery: "",
      automaticStatus: "not_started",
      steps: [{ toolResults: [{ toolName: "search_memory", input: { query: "台风" }, output: "(memory service not connected)" }] }],
    });

    expect(found.found).toBe(true);
    expect(unavailable.unavailable).toBe(true);
  });

  test("detects full Memory reads and Skill hints", () => {
    const result = summarizeMemoryRead([
      { toolResults: [{ toolName: "read_memory", input: { id: "abc123" }, output: '<Memory id="abc123">使用 Typhoon Skill</Memory>' }] },
    ]);

    expect(result.read).toBe(true);
    expect(result.suggestsSkill).toBe(true);
  });
});

describe("summarizeSkillDiscovery", () => {
  test("detects that the Skill catalog was checked", () => {
    const result = summarizeSkillDiscovery([{ toolResults: [{ toolName: "skill_list", input: {}, output: "[]" }] }]);

    expect(result.checked).toBe(true);
    expect(result.loaded).toBe(false);
  });

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

describe("transient memory traversal context", () => {
  const traversalCall = { role: "assistant", content: [{
    type: "tool-call", toolCallId: "traverse-1", toolName: "traverse_memory", input: { startId: "abc123" },
  }] };
  const traversalResult = { role: "tool", content: [{
    type: "tool-result", toolCallId: "traverse-1", toolName: "traverse_memory",
    output: { type: "text", value: '<MemorySummary id="abc123">root</MemorySummary>' },
  }] };

  test("keeps traversal results for the immediate consumer step", () => {
    const messages = [{ role: "user", content: "browse memory" }, traversalCall, traversalResult] as any;
    expect(pruneConsumedTransientTools(messages)).toEqual(messages);
  });

  test("removes traversal calls and results after another tool step", () => {
    const messages = [
      { role: "user", content: "browse memory" },
      traversalCall,
      traversalResult,
      { role: "assistant", content: [{
        type: "tool-call", toolCallId: "read-1", toolName: "read_memory", input: { id: "abc123" },
      }] },
      { role: "tool", content: [{
        type: "tool-result", toolCallId: "read-1", toolName: "read_memory",
        output: { type: "text", value: '<Memory id="abc123">full</Memory>' },
      }] },
    ] as any;

    const pruned = pruneConsumedTransientTools(messages);
    expect(JSON.stringify(pruned)).not.toContain("traverse_memory");
    expect(JSON.stringify(pruned)).toContain("read_memory");
  });

  test("removes consumed history chunks after the next tool step", () => {
    const messages = [
      { role: "user", content: "verify the original" },
      { role: "assistant", content: [{
        type: "tool-call", toolCallId: "history-1", toolName: "read_history", input: { archiveId: "message-000001" },
      }] },
      { role: "tool", content: [{
        type: "tool-result", toolCallId: "history-1", toolName: "read_history",
        output: { type: "text", value: "archived text" },
      }] },
      { role: "assistant", content: [{
        type: "tool-call", toolCallId: "search-1", toolName: "search_memory", input: { query: "next" },
      }] },
      { role: "tool", content: [{
        type: "tool-result", toolCallId: "search-1", toolName: "search_memory",
        output: { type: "text", value: "none" },
      }] },
    ] as any;

    const pruned = pruneConsumedTransientTools(messages);
    expect(JSON.stringify(pruned)).not.toContain("read_history");
    expect(JSON.stringify(pruned)).toContain("search_memory");
  });

  test("does not persist traversal output across conversations", () => {
    expect(shouldPersistToolResult("traverse_memory")).toBe(false);
    expect(shouldPersistToolResult("search_history")).toBe(false);
    expect(shouldPersistToolResult("read_history")).toBe(false);
    expect(shouldPersistToolResult("read_memory")).toBe(true);
  });
});

describe("persistent tool context", () => {
  test("keeps an explicitly injected TTL Memory in the current topic", () => {
    const bus = makeBus();
    const contextService = new ContextService(bus, { sweepIntervalMs: 0 });
    contextService.start();
    const injection = {
      scope: "topic" as const,
      entry: {
        key: "memory:abcdef",
        source: "memory",
        channel: "messages" as const,
        trust: "untrusted" as const,
        priority: 650,
        content: [{ role: "assistant", content: "persistent memory" }],
        expiresAt: Date.now() + 60_000,
      },
    };

    expect(injectToolContext({
      contextService,
      injection,
      sessionId: "s1",
      topicId: "topic-a",
    })).toBe("topic");

    const snapshot = contextService.createSnapshot({ sessionId: "s1", topicId: "topic-a" });
    contextService.commitSnapshot(snapshot.id);
    const data = decode(snapshot.content) as { context: Array<Record<string, unknown>> };
    expect(data.context[0]?.content).toBe("persistent memory");
    expect(contextService.get(
      "topic",
      { sessionId: "s1", topicId: "topic-a" },
      "memory:abcdef",
    )).toBeDefined();
  });

  test("falls back to session scope when there is no active topic", () => {
    const bus = makeBus();
    const contextService = new ContextService(bus, { sweepIntervalMs: 0 });
    contextService.start();
    const scope = injectToolContext({
      contextService,
      sessionId: "s1",
      injection: {
        scope: "topic",
        entry: {
          key: "memory:abcdef",
          source: "memory",
          channel: "messages",
          trust: "untrusted",
          priority: 650,
          content: [{ role: "assistant", content: "persistent memory" }],
          expiresAt: Date.now() + 60_000,
        },
      },
    });

    expect(scope).toBe("session");
    expect(contextService.get("session", { sessionId: "s1" }, "memory:abcdef")).toBeDefined();
  });

  test("keeps pinned Memory at session scope even when a topic is active", () => {
    const contextService = new ContextService(makeBus(), { sweepIntervalMs: 0 });
    contextService.start();
    const scope = injectToolContext({
      contextService,
      sessionId: "s1",
      topicId: "topic-a",
      injection: {
        scope: "session",
        entry: {
          key: "memory:address",
          source: "memory",
          channel: "messages",
          trust: "untrusted",
          priority: 650,
          pinned: true,
          content: [{ role: "assistant", content: "family address" }],
        },
      },
    });

    expect(scope).toBe("session");
    expect(contextService.get("session", { sessionId: "s1" }, "memory:address")?.pinned).toBe(true);
    expect(contextService.get(
      "topic",
      { sessionId: "s1", topicId: "topic-a" },
      "memory:address",
    )).toBeUndefined();
  });

  test("renews the expiry when the same TTL Memory is injected again", () => {
    const contextService = new ContextService(makeBus(), { sweepIntervalMs: 0 });
    contextService.start();
    const inject = (expiresAt: number) => injectToolContext({
      contextService,
      sessionId: "s1",
      topicId: "topic-a",
      injection: {
        scope: "topic",
        entry: {
          key: "memory:weather",
          source: "memory",
          channel: "messages",
          trust: "untrusted",
          priority: 650,
          expiresAt,
          content: [{ role: "assistant", content: "weather workflow" }],
        },
      },
    });

    inject(100);
    inject(200);

    const owner = { sessionId: "s1", topicId: "topic-a" };
    expect(contextService.get("topic", owner, "memory:weather")?.revision).toBe(2);
    expect(contextService.get("topic", owner, "memory:weather")?.expiresAt).toBe(200);
    contextService.sweepExpired(150);
    expect(contextService.get("topic", owner, "memory:weather")).toBeDefined();
    contextService.sweepExpired(200);
    expect(contextService.get("topic", owner, "memory:weather")).toBeUndefined();
  });
});
