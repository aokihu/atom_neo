import { TaskSource } from "@atom-neo/shared";
import type { TaskItem } from "@atom-neo/shared";
import { createTaskItem } from "../task-factory";
import type { SessionContext } from "./context";
import type { ExecutionBudget } from "./types";

export type BudgetLimits = { maxGlobalRounds: number; maxLocalRounds: number };

export function startExecutionGoal(session: SessionContext, goalId: string, goal: string, allowance: number): void {
  session.executionBudget = {
    goalId, goal, globalUsed: 0, globalAllowance: allowance, localUsed: 0,
    goalStartSeq: session.messages.findLast(message => message.role === "user" && message.content === goal)?.seq ?? session.messages.at(-1)?.seq ?? 0,
    windowId: 0, windowStartSeq: (session.messages.at(-1)?.seq ?? 0) + 1,
    todoBaseline: structuredClone([...session.todoState]), releasedTaskIds: [],
  };
  session.legacyBudgetDepth = undefined;
}

export function budgetPauseMessage(session: SessionContext, reason: string): string {
  const todos = session.todoState;
  const completed = todos.filter(todo => todo.status === "completed").map(todo => todo.content);
  const remaining = todos.filter(todo => todo.status === "pending" || todo.status === "in_progress").map(todo => todo.content);
  return `自动执行已暂停，任务尚未确认完成：${reason}。\n已完成：${completed.join("；") || "已保存的输出"}。\n剩余：${remaining.join("；") || "原始目标仍需确认"}。进度已保留，发送“继续”可恢复。`;
}

export function createBudgetCheck(budget: ExecutionBudget): TaskItem {
  const pending = budget.pendingTask!;
  return createTaskItem({ sessionId: pending.sessionId, chatId: pending.chatId,
    parentTaskId: pending.parentTaskId, chainId: pending.chainId, origin: pending.origin,
    pipeline: "follow-up-evaluator", source: TaskSource.INTERNAL,
    payload: [{ type: "budget_check", data: { goalId: budget.goalId, windowId: budget.windowId } }],
  });
}

/** The only conversation release policy. Persistence precedes admission; no semantic calculations. */
export function prepareBudgetRelease(params: {
  session: SessionContext; task: TaskItem; limits: BudgetLimits;
  save: () => boolean; report: (step: string, data: Record<string, unknown>) => void;
  notify: (text: string) => void;
}): TaskItem | undefined {
  const { session, task, limits, save, report, notify } = params;
  if (task.pipeline !== "conversation") return task;
  // Direct external/scheduled roots start their own goal; child/recovery tasks retain it.
  if (task.chainId === task.id && task.parentTaskId === task.id && session.executionBudget?.goalId !== task.chainId) {
    const goal = task.payload.find(part => part.type === "text")?.data ?? "";
    startExecutionGoal(session, task.chainId, goal, limits.maxGlobalRounds);
  }
  if (!session.executionBudget) {
    const goal = session.messages.findLast(message => message.role === "user" && !/^(继续|continue)$/i.test(message.content))?.content
      ?? task.payload.find(part => part.type === "text")?.data ?? "";
    const legacy = session.legacyBudgetDepth;
    startExecutionGoal(session, task.chainId, goal, limits.maxGlobalRounds);
    if (legacy !== undefined) {
      Object.assign(session.executionBudget!, { globalUsed: legacy + 1, localUsed: limits.maxLocalRounds,
        legacyEvidenceMissing: true, windowStartSeq: 0 });
    }
  }
  const budget = session.executionBudget!;
  if (budget.releasedTaskIds.includes(task.id)) {
    report("replay-suppressed", { taskId: task.id, goalId: budget.goalId });
    return;
  }
  if (budget.pause && (!budget.pendingTask || budget.pendingTask.id !== task.id)) {
    report("paused-request-rejected", { taskId: task.id, goalId: budget.goalId, pause: budget.pause });
    return;
  }
  if (budget.pause === "cancelled" || budget.pause === "unhealthy" || budget.pause === "unknown" || budget.pause === "health_check") return;
  const before = structuredClone(budget);
  budget.completed = false;
  budget.pendingTask = structuredClone(task);
  if (budget.globalUsed >= budget.globalAllowance) {
    budget.pause = "global_limit";
    budget.resuming = false;
    const text = budgetPauseMessage(session, `已达到全局轮次上限 ${budget.globalUsed}/${budget.globalAllowance}`);
    session.addMessage({ role: "assistant", content: text, visible: true, pipeline: "budget", timestamp: Date.now() });
    const seq = session.messages.at(-1)?.seq;
    if (!save()) { session.executionBudget = before; if (seq !== undefined) session.removeMessages([seq]); return; }
    notify(text);
    report("global-limit", { taskId: task.id, before, after: structuredClone(budget) });
    return;
  }
  if (budget.localUsed >= limits.maxLocalRounds) {
    budget.pause = "health_check";
    budget.resuming = true;
    if (!save()) { session.executionBudget = before; return; }
    report("window-check", { taskId: task.id, before, after: structuredClone(budget) });
    return createBudgetCheck(budget);
  }
  budget.globalUsed++;
  budget.localUsed++;
  budget.releasedTaskIds.push(task.id);
  budget.lastReleasedTask = structuredClone(task);
  budget.pendingTask = undefined;
  budget.pause = undefined;
  budget.resuming = false;
  if (!save()) { session.executionBudget = before; report("save-failed", { taskId: task.id, goalId: budget.goalId }); return; }
  report("released", { taskId: task.id, goalId: budget.goalId, windowId: budget.windowId,
    before: { globalUsed: before.globalUsed, localUsed: before.localUsed },
    after: { globalUsed: budget.globalUsed, globalAllowance: budget.globalAllowance, localUsed: budget.localUsed } });
  return task;
}

export function resumeExecutionBudget(session: SessionContext, allowance: number): TaskItem | undefined {
  const budget = session.executionBudget;
  if (!budget?.pause || !budget.pendingTask || budget.resuming || budget.pause === "cancelled") return;
  budget.resuming = true;
  if (budget.pause === "interrupted") { budget.pause = undefined; return budget.pendingTask; }
  if (budget.pause === "global_limit") {
    budget.globalAllowance += allowance;
    budget.pause = undefined;
    return budget.pendingTask;
  }
  budget.pause = "health_check";
  return createBudgetCheck(budget);
}
