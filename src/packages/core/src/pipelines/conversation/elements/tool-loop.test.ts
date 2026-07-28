import { describe, expect, test } from "bun:test";
import {
  buildToolStepInstruction,
  projectProgressToolMessages,
  shouldDiscardUnverifiedFinal,
  stripToolCallMarkup,
  toSchemaOnlyTools,
} from "./tool-loop";

describe("manual tool loop context projection", () => {
  test("removes execute callbacks before tools reach AI SDK", () => {
    const execute = async () => "secret";
    const tools = toSchemaOnlyTools({
      search: { description: "search", inputSchema: {}, execute },
    });

    expect(tools.search.execute).toBeUndefined();
    expect(tools.search.description).toBe("search");
  });

  test("projects only calls with framework progress", () => {
    const calls = [
      { toolCallId: "ok-1", toolName: "search", input: { q: "useful" } },
      { toolCallId: "empty-1", toolName: "search", input: { q: "empty" } },
    ];
    const messages = projectProgressToolMessages(calls, new Map([
      ["ok-1", {
        toolName: "search",
        input: calls[0]!.input,
        output: "evidence",
        outcome: { status: "success", progress: "evidence" },
      }],
      ["empty-1", {
        toolName: "search",
        input: calls[1]!.input,
        output: "No results",
        outcome: { status: "empty", progress: "none" },
      }],
    ]));

    expect(JSON.stringify(messages)).toContain("ok-1");
    expect(JSON.stringify(messages)).not.toContain("empty-1");
    expect(JSON.stringify(messages)).not.toContain("No results");
  });

  test("drops the whole batch when every outcome has no progress", () => {
    const calls = [{ toolCallId: "error-1", toolName: "webfetch", input: { url: "https://example.com" } }];
    expect(projectProgressToolMessages(calls, new Map([
      ["error-1", {
        toolName: "webfetch",
        input: calls[0]!.input,
        output: "timeout",
        outcome: { status: "error", progress: "none" },
      }],
    ]))).toEqual([]);
  });

  test("uses framework state instead of raw failure output", () => {
    expect(buildToolStepInstruction({
      noProgress: true,
      webfetchGuardReason: "skill_search_required",
      nextAction: "Call skill_list.",
    })).toContain("skill_search_required");
    expect(buildToolStepInstruction({
      noProgress: true,
      webfetchGuardReason: "skill_search_required",
      nextAction: "Call skill_list.",
    })).toContain("Call skill_list.");
    expect(buildToolStepInstruction({
      noProgress: true,
      stopReason: "consecutive_no_progress",
    })).toContain("has stopped");
  });

  test("removes provider tool-call markup from persisted Assistant text", () => {
    expect(stripToolCallMarkup("先查询。<｜｜DSML｜｜tool_calls>bad")).toBe("先查询。");
    expect(stripToolCallMarkup("<｜｜DSML｜｜tool_calls>bad")).toBe("");
  });

  test("discards a final assertion only when governance stopped without progress", () => {
    expect(shouldDiscardUnverifiedFinal([
      { status: "empty", progress: "none" },
      { status: "error", progress: "none" },
    ], "consecutive_no_progress")).toBe(true);
    expect(shouldDiscardUnverifiedFinal([
      { status: "success", progress: "evidence" },
      { status: "error", progress: "none" },
    ], "consecutive_no_progress")).toBe(false);
    expect(shouldDiscardUnverifiedFinal([
      { status: "empty", progress: "none" },
    ])).toBe(false);
  });
});
