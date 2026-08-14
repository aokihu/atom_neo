import { describe, expect, test } from "bun:test";
import {
  buildToolStepInstruction,
  formatToolBatchBlock,
  projectToolMessages,
  stripToolCallMarkup,
  toSchemaOnlyTools,
  validateToolCallBatch,
} from "./tool-loop";

const call = (toolCallId: string, toolName: string, input: unknown = {}) => ({
  toolCallId,
  toolName,
  input,
});

describe("Tool call batches", () => {
  const batchable = new Set(["search_memory", "read_memory"]);

  test("allows different queries through the same batchable Tool", () => {
    expect(validateToolCallBatch([
      call("memory-1", "search_memory", { query: "杭州" }),
      call("memory-2", "search_memory", { query: "天气流程" }),
    ], batchable)).toEqual({ allowed: true });
  });

  test("rejects mixed Tool names as one batch", () => {
    const decision = validateToolCallBatch([
      call("memory-1", "search_memory", { query: "天气" }),
      call("ls-1", "ls", { path: "." }),
    ], batchable);

    expect(decision).toEqual({
      allowed: false,
      reason: "mixed_tool_names",
      toolNames: ["search_memory", "ls"],
    });
    if (decision.allowed) throw new Error("expected mixed batch to be blocked");
    expect(formatToolBatchBlock(decision)).toContain("TOOL_BATCH_BLOCKED [mixed_tool_names]");
  });

  test("rejects repeated state, control, WebFetch, and unknown MCP Tools", () => {
    for (const toolName of ["write", "intent", "todowrite", "webfetch", "mcp_weather"]) {
      expect(validateToolCallBatch([
        call(`${toolName}-1`, toolName),
        call(`${toolName}-2`, toolName),
      ], batchable)).toEqual({
        allowed: false,
        reason: "tool_not_batchable",
        toolNames: [toolName],
      });
    }
  });

  test("allows different Tools only as separate single-call steps", () => {
    expect(validateToolCallBatch([call("memory-1", "search_memory")], batchable)).toEqual({ allowed: true });
    expect(validateToolCallBatch([call("ls-1", "ls")], batchable)).toEqual({ allowed: true });
  });

  test("keeps a rejected result paired with every call id", () => {
    const calls = [call("memory-1", "search_memory"), call("ls-1", "ls")];
    const error = "TOOL_BATCH_BLOCKED [mixed_tool_names]";
    const messages = projectToolMessages(calls, new Map(calls.map(item => [item.toolCallId, {
      toolName: item.toolName,
      input: item.input,
      content: "",
      metadata: { ok: false as const, effect: "none" as const, error, errorSource: "guard" as const },
    }])));
    const projected = JSON.stringify(messages);

    expect(projected).toContain("memory-1");
    expect(projected).toContain("ls-1");
    expect(projected.match(/TOOL_BATCH_BLOCKED/g)).toHaveLength(2);
  });
});

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
        metadata: { ok: false, effect: "none", error: "timeout", errorSource: "tool" },
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
