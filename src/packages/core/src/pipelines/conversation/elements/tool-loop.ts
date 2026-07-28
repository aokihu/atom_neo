import type { ModelMessage } from "ai";
import type { ToolOutcome } from "@atom-neo/shared";

export type ManualToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

export type ToolStepRecord = {
  toolName: string;
  input: unknown;
  output: unknown;
  outcome: ToolOutcome;
};

export function toSchemaOnlyTools(tools: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(tools).map(([name, value]) => {
    if (!value || typeof value !== "object") return [name, value];
    const { execute: _execute, ...definition } = value;
    return [name, definition];
  }));
}

export function projectProgressToolMessages(
  calls: readonly ManualToolCall[],
  records: ReadonlyMap<string, ToolStepRecord>,
): ModelMessage[] {
  const projected = calls.flatMap(call => {
    const record = records.get(call.toolCallId);
    return record && record.outcome.progress !== "none" ? [{ call, record }] : [];
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
        output: { type: "text" as const, value: stringifyToolOutput(record.output) },
      })),
    },
  ];
}

export function buildToolStepInstruction(params: {
  noProgress: boolean;
  stopReason?: string;
  webfetchGuardReason?: string;
  nextAction?: string;
}): string {
  if (params.stopReason) {
    return "Framework tool execution has stopped. Do not emit another tool call. Answer only from verified evidence already available, or clearly state that the task is blocked.";
  }
  if (!params.noProgress) return "";
  return [
    "The previous tool attempt produced no usable evidence and was removed from model context.",
    "Do not repeat the same tool call. Choose a materially different action or input.",
    params.webfetchGuardReason ? `Current webfetch prerequisite state: ${params.webfetchGuardReason}.` : "",
    params.nextAction ?? "",
  ].filter(Boolean).join(" ");
}

export function stripToolCallMarkup(text: string): string {
  const marker = "<｜｜DSML｜｜tool_calls>";
  const index = text.indexOf(marker);
  return (index < 0 ? text : text.slice(0, index)).trim();
}

export function shouldDiscardUnverifiedFinal(
  outcomes: readonly ToolOutcome[],
  stopReason?: string,
): boolean {
  return Boolean(stopReason && !outcomes.some(outcome => outcome.progress !== "none"));
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
