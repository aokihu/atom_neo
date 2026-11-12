import type { ContinuationDecision, TodoTarget } from "@atom-neo/shared";
import type { TodoItem } from "../../../session/context";
import type { ConversationFlowState } from "./types";

export type ContinuationRouting = {
  todos: readonly TodoItem[];
  active: boolean;
  current?: TodoTarget;
  terminal: boolean;
  next?: TodoTarget;
  target?: TodoTarget;
  request?: ContinuationDecision;
  followUp?: ContinuationDecision["followUp"];
  follow: boolean;
  decisionMode?: "jev" | "rules";
};

export type ContinuationRuleResult = {
  decision: ContinuationDecision;
  stopReconciliation?: boolean;
  suppressPostCheck?: boolean;
};

/** Build a decision with the same target precedence used by every rule. */
export function buildContinuationDecision(
  kind: ContinuationDecision["kind"],
  reason: string,
  source: ContinuationDecision["source"],
  routing: Pick<ContinuationRouting, "next" | "target" | "followUp">,
): ContinuationDecision {
  return {
    kind,
    reason,
    source,
    target: kind === "advance_todo" ? routing.next : routing.target,
    ...(routing.followUp ? { followUp: routing.followUp } : {}),
  };
}

const sameTodos = (before: readonly TodoItem[] | undefined, after: readonly TodoItem[]) =>
  JSON.stringify(before ?? []) === JSON.stringify(after);

/**
 * Evaluate every rules-only continuation branch in priority order.
 * Returns null when semantic arbitration is required.
 */
export function evaluateContinuationRules(
  input: ConversationFlowState,
  routing: ContinuationRouting,
): ContinuationRuleResult | null {
  const decide = (kind: ContinuationDecision["kind"], reason: string) =>
    buildContinuationDecision(kind, reason, "rules", routing);

  if (input.cancelled || input.abortSignal?.aborted || (input.errorStatusCode ?? 0) >= 400 || input.toolStopReason) {
    return { decision: decide("finish", "runtime_stopped"), suppressPostCheck: true };
  }
  if (input.tokenOverflow) return { decision: { ...routing.request, kind: "resume_current",
    reason: "context_overflow", source: "rules", target: routing.target,
    ...(routing.followUp ? { followUp: routing.followUp } : {}) } };
  if (routing.request?.kind === "reconcile_progress") {
    if (sameTodos(input.todoBefore, routing.todos)) {
      return { decision: { kind: "finish", reason: "reconciliation_failed", source: "rules" }, stopReconciliation: true };
    }
    if (!routing.active) return { decision: decide("finish", "progress_reconciled") };
    if (routing.terminal || !input.currentTodo) return { decision: decide("advance_todo", "progress_reconciled") };
    if (routing.current) return { decision: decide("resume_current", "current_task_confirmed") };
    return { decision: { kind: "finish", reason: "reconciliation_failed", source: "rules" }, stopReconciliation: true };
  }
  if (input.finishReason === "length" || input.streamInterrupted || input.finishReason === "error") {
    return { decision: decide("resume_current", "output_interrupted") };
  }
  const lostCurrent = !!input.currentTodo && !routing.current;
  const handoff = routing.terminal && !!routing.next;
  if (!routing.follow && !input.completeDetected && handoff) return { decision: decide("advance_todo", "todo_handoff") };
  if (!lostCurrent && !routing.active && !routing.follow) return { decision: decide("finish", "output_finished") };
  if (!(input.todoBefore?.length || routing.todos.length) && routing.follow) {
    return { decision: decide("resume_current", "explicit_follow_up") };
  }
  if (!input.currentTodo && !routing.follow && !input.completeDetected && routing.next && !input.responseText?.trim()
    && sameTodos(input.todoBefore, routing.todos)) return { decision: decide("advance_todo", "pending_plan") };

  if (routing.decisionMode === "rules") return { decision: decide("reconcile_progress", "ambiguous_progress") };
  return null;
}
