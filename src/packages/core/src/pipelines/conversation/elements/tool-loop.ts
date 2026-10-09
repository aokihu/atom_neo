import type { ModelMessage } from "ai";
import type { ToolResultMetadata } from "@atom-neo/shared";

export type ManualToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

export type ToolStepRecord = {
  toolName: string;
  input: unknown;
  content?: unknown;
  metadata: ToolResultMetadata;
};

export type ToolBatchBlockReason = "mixed_tool_names" | "tool_not_batchable";

export type ToolBatchDecision =
  | { allowed: true }
  | { allowed: false; reason: ToolBatchBlockReason; toolNames: string[] };

export function validateToolCallBatch(
  calls: readonly ManualToolCall[],
  allowSameToolBatchNames: ReadonlySet<string>,
): ToolBatchDecision {
  if (calls.length <= 1) return { allowed: true };
  const toolNames = [...new Set(calls.map(call => call.toolName))];
  if (toolNames.length !== 1) return { allowed: false, reason: "mixed_tool_names", toolNames };
  return allowSameToolBatchNames.has(toolNames[0]!)
    ? { allowed: true }
    : { allowed: false, reason: "tool_not_batchable", toolNames };
}

export function formatToolBatchBlock(decision: Extract<ToolBatchDecision, { allowed: false }>): string {
  return decision.reason === "mixed_tool_names"
    ? `TOOL_BATCH_BLOCKED [mixed_tool_names]: one model step may call only one Tool name; received ${decision.toolNames.join(", ")}. Wait for one Tool batch to finish before choosing another Tool.`
    : `TOOL_BATCH_BLOCKED [tool_not_batchable]: ${decision.toolNames[0]} allows only one call per model step. Wait for its result before calling it again or choosing another Tool.`;
}

export function toSchemaOnlyTools(tools: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(tools).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => {
    if (!value || typeof value !== "object") return [name, value];
    const { execute: _execute, ...definition } = value;
    return [name, definition];
  }));
}

export function projectToolMessages(
  calls: readonly ManualToolCall[],
  records: ReadonlyMap<string, ToolStepRecord>,
  assistantText = "",
  assistantReasoning = "",
): ModelMessage[] {
  const projected = calls.flatMap(call => {
    const record = records.get(call.toolCallId);
    return record ? [{ call, record }] : [];
  });
  if (projected.length === 0) return [];
  return [
    {
      role: "assistant",
      content: [
        ...(assistantReasoning ? [{ type: "reasoning" as const, text: assistantReasoning }] : []),
        ...(assistantText ? [{ type: "text" as const, text: assistantText }] : []),
        ...projected.map(({ call }) => ({
          type: "tool-call" as const,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
        })),
      ],
    },
    {
      role: "tool",
      content: projected.map(({ call, record }) => ({
        type: "tool-result" as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { type: "text" as const, value: stringifyToolResult(record) },
      })),
    },
  ];
}

export function buildToolStepInstruction(params: {
  consecutiveNoProgress: number;
  warningThreshold: number;
  stopReason?: string;
}): string {
  if (params.stopReason) {
    return "The tool execution limit was reached. Do not emit another tool call. Answer from the results already available or clearly state what remains unresolved.";
  }
  return params.consecutiveNoProgress >= params.warningThreshold
    ? "Several recent tool calls produced no useful result. Reassess the user's goal and the results already returned before choosing the next action. Avoid repeating equivalent calls."
    : "";
}

export function stripToolCallMarkup(text: string): string {
  const marker = "<｜｜DSML｜｜tool_calls>";
  const index = text.indexOf(marker);
  return (index < 0 ? text : text.slice(0, index)).trim();
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output === undefined) return "";
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function stringifyToolResult(record: ToolStepRecord): string {
  const content = stringifyToolOutput(record.content);
  if (content) return content;
  return record.metadata.ok ? "" : record.metadata.error;
}
