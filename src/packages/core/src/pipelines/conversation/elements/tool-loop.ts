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

export function toSchemaOnlyTools(tools: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(tools).map(([name, value]) => {
    if (!value || typeof value !== "object") return [name, value];
    const { execute: _execute, ...definition } = value;
    return [name, definition];
  }));
}

export function projectToolMessages(
  calls: readonly ManualToolCall[],
  records: ReadonlyMap<string, ToolStepRecord>,
): ModelMessage[] {
  const projected = calls.flatMap(call => {
    const record = records.get(call.toolCallId);
    return record ? [{ call, record }] : [];
  });
  if (projected.length === 0) return [];
  return [
    {
      role: "assistant",
      content: projected.map(({ call }) => ({
        type: "tool-call" as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
      })),
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
