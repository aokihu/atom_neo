import { describe, expect, test } from "bun:test";
import {
  buildToolStepInstruction,
  projectToolMessages,
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

  test("projects every executed Tool result", () => {
    const calls = [
      { toolCallId: "ok-1", toolName: "search", input: { q: "useful" } },
      { toolCallId: "empty-1", toolName: "search", input: { q: "empty" } },
    ];
    const messages = projectToolMessages(calls, new Map([
      ["ok-1", {
        toolName: "search",
        input: calls[0]!.input,
        content: "evidence",
        metadata: { ok: true, effect: "evidence" },
      }],
      ["empty-1", {
        toolName: "search",
        input: calls[1]!.input,
        metadata: { ok: true, effect: "none" },
      }],
    ]));

    expect(JSON.stringify(messages)).toContain("ok-1");
    expect(JSON.stringify(messages)).toContain("empty-1");
  });

  test("projects framework errors to the model", () => {
    const calls = [{ toolCallId: "error-1", toolName: "webfetch", input: { url: "https://example.com" } }];
    const messages = projectToolMessages(calls, new Map([
      ["error-1", {
        toolName: "webfetch",
        input: calls[0]!.input,
        content: "",
        metadata: { ok: false, effect: "none", error: "timeout" },
      }],
    ]));

    expect(JSON.stringify(messages)).toContain("error-1");
    expect(JSON.stringify(messages)).toContain("timeout");
  });

  test("warns without choosing the next Tool and stops only at the hard limit", () => {
    expect(buildToolStepInstruction({
      consecutiveNoProgress: 2,
      warningThreshold: 3,
    })).toBe("");
    const warning = buildToolStepInstruction({
      consecutiveNoProgress: 3,
      warningThreshold: 3,
    });
    expect(warning).toContain("Reassess");
    expect(warning).not.toContain("skill_list");
    expect(buildToolStepInstruction({
      consecutiveNoProgress: 3,
      warningThreshold: 3,
      stopReason: "tool_call_limit",
    })).toContain("execution limit");
  });

  test("removes provider tool-call markup from persisted Assistant text", () => {
    expect(stripToolCallMarkup("先查询。<｜｜DSML｜｜tool_calls>bad")).toBe("先查询。");
    expect(stripToolCallMarkup("<｜｜DSML｜｜tool_calls>bad")).toBe("");
  });
});
