import { substringWellFormed } from "@atom-neo/shared";
import type { TodoTarget } from "@atom-neo/shared";
import type { TodoItem } from "../../session/context";
import { findTodoTarget } from "../../session/context";

export type ProgressTrace = {
  target?: TodoTarget; before?: TodoItem["status"]; after?: TodoItem["status"];
  terminalCause: string;
};
export type EvidencePart = { seq?: number; content: string; metadata?: Record<string, unknown> };
export type ProgressEvidence = ReturnType<typeof buildProgressEvidence>;

export function getProgressTrace(part: EvidencePart): ProgressTrace | undefined {
  return part.metadata?.progress as ProgressTrace | undefined;
}

export function createProgressTrace(input: any, todos: readonly TodoItem[]): ProgressTrace {
  const target = input.currentTodo as TodoTarget | undefined;
  const before = findTodoTarget(input.todoBefore ?? [], target)?.todo.status;
  const after = findTodoTarget(todos, target)?.todo.status;
  const terminalCause = input.cancelled || input.abortSignal?.aborted ? "cancelled"
    : input.toolStopReason ? "tool_governance" : input.tokenOverflow ? "context_overflow"
    : input.finishReason === "length" ? "length_cutoff" : input.streamInterrupted ? "interrupted"
    : input.intents?.some((intent: any) => intent.request === "follow_up") ? "intent_segment"
    : input.todoHandoff ? (after === "completed" || after === "cancelled" ? "todo_handoff" : "progress_check") : "natural_stop";
  return { target, before, after, terminalCause };
}

/** Shared factual evidence; bounded excerpts never imply that omitted content is absent. */
export function buildProgressEvidence(params: {
  parts: EvidencePart[]; todos: readonly TodoItem[]; goal: string;
  current?: EvidencePart; trace?: ProgressTrace; before?: readonly TodoItem[];
  budget?: number;
}) {
  const { parts, trace, current } = params;
  const all = current ? [...parts, current] : parts;
  const visible = all.slice(-16);
  let budget = params.budget ?? 2400;
  const outputs = visible.map((part, i) => {
    const allowance = Math.max(0, Math.floor(budget / (visible.length - i)));
    const truncated = part.content.length > allowance;
    const text = truncated
      ? `${substringWellFormed(part.content, 0, Math.floor(allowance / 2))}\n[omitted]\n${substringWellFormed(part.content, Math.max(0, part.content.length - Math.ceil(allowance / 2)))}`
      : part.content;
    budget -= Math.min(part.content.length, allowance);
    return { ref: part === current ? "current" : String(part.seq ?? `part-${all.indexOf(part) + 1}`),
      target: getProgressTrace(part)?.target, text, truncated, originalChars: part.content.length };
  });
  return {
    target: trace?.target,
    todoSnapshot: { before: params.before ?? [], after: params.todos },
    outputRefs: outputs,
    todoTransition: { before: trace?.before, after: trace?.after },
    terminalCause: trace?.terminalCause ?? getProgressTrace(parts.at(-1) ?? { content: "" })?.terminalCause,
    reviewCoverage: { complete: visible.length === all.length && outputs.every(output => !output.truncated),
      providedParts: visible.length, totalParts: all.length, omittedParts: all.length - visible.length },
  };
}

/** Text is already in the review; pass its scope and references without repeating it. */
export function getProgressFacts(evidence: ProgressEvidence) {
  return { ...evidence, outputRefs: evidence.outputRefs.map(({ text, ...facts }) => facts) };
}
