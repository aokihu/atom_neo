import { test, expect } from "bun:test";
import { SessionContext } from "./context";
import { prepareBudgetRelease, resumeExecutionBudget, startExecutionGoal } from "./execution-budget";
import { createTaskItem } from "../task-factory";
import { TaskSource } from "@atom-neo/shared";
import { TaskQueue } from "../task-queue";
import { InternalTaskOrchestrator } from "../task/internal-task-orchestrator";

const limits = { maxGlobalRounds: 100, maxLocalRounds: 5 };
function setup(allowance = 100) {
  const session = new SessionContext("s");
  session.addMessage({ role: "user", content: "original goal", timestamp: 1 });
  startExecutionGoal(session, "goal", "original goal", allowance);
  const logs: any[] = [];
  let canSave = true;
  const task = (pipeline = "conversation") => createTaskItem({ sessionId: "s", chatId: "c", pipeline,
    source: TaskSource.INTERNAL, chainId: "goal", payload: [{ type: "text", data: "continue exact payload" }] });
  const release = (item = task()) => prepareBudgetRelease({ session, task: item, limits,
    save: () => canSave, report: (step, data) => logs.push({ step, data }), notify: text => logs.push({ text }) });
  return { session, task, release, logs, failSave: () => { canSave = false; } };
}

test("completion survives restore without erasing usage; new work reopens it only after persistence", () => {
  const s = setup();
  s.release();
  s.session.executionBudget!.lastReleasedTask = undefined;
  s.session.executionBudget!.completed = true;
  const state = s.session.exportState({ checkpointRevision: 1, status: "active", archives: { segmentCount: 0, archivedMessageCount: 0, latestMessageCount: 1, nextSegment: 1 } });
  const restored = SessionContext.restore(state, s.session.messages);
  expect(restored.executionBudget).toMatchObject({ completed: true, globalUsed: 1, localUsed: 1 });
  expect(s.release()).toBeDefined();
  expect(s.session.executionBudget).toMatchObject({ completed: false, globalUsed: 2 });
  s.session.executionBudget!.completed = true;
  s.failSave();
  expect(s.release()).toBeUndefined();
  expect(s.session.executionBudget).toMatchObject({ completed: true, globalUsed: 2 });
});

test("five released business/reconciliation rounds trigger an uncharged health check", () => {
  const s = setup();
  for (let i = 0; i < 5; i++) expect(s.release()?.pipeline).toBe("conversation");
  const sixth = s.task();
  sixth.payload.push({ type: "continuation_request", data: { kind: "reconcile_progress", source: "rules", reason: "check",
    target: { index: 0, content: "chapter" }, followUp: { nextPrompt: "exact", summary: "saved", avoidRepeat: "old" } } });
  expect(s.release(sixth)?.pipeline).toBe("follow-up-evaluator");
  expect(s.session.executionBudget).toMatchObject({ globalUsed: 5, localUsed: 5, pause: "health_check", pendingTask: sixth });
});

test("global limit retains original payload; resume appends allowance once without erasing usage", () => {
  const s = setup(2);
  s.release(); s.release(); const pending = s.task();
  expect(s.release(pending)).toBeUndefined();
  expect(s.session.executionBudget?.pause).toBe("global_limit");
  expect(resumeExecutionBudget(s.session, 100)).toEqual(pending);
  expect(resumeExecutionBudget(s.session, 100)).toBeUndefined();
  expect(s.release(pending)).toEqual(pending);
  expect(s.session.executionBudget).toMatchObject({ globalAllowance: 102, globalUsed: 3, localUsed: 3, goal: "original goal" });
  expect(s.logs.find(log => log.text)?.text).toContain("任务尚未确认完成");
});

test("global extension still checks a full local window", () => {
  const s = setup(5);
  for (let i = 0; i < 5; i++) s.release();
  s.release();
  const pending = resumeExecutionBudget(s.session, 100)!;
  expect(s.release(pending)?.pipeline).toBe("follow-up-evaluator");
  expect(s.session.executionBudget).toMatchObject({ globalUsed: 5, localUsed: 5, globalAllowance: 105 });
});

test("unhealthy resume rechecks the original window without extra grant or reset", () => {
  const s = setup();
  for (let i = 0; i < 6; i++) s.release();
  s.session.executionBudget!.pause = "unhealthy";
  s.session.executionBudget!.resuming = false;
  const check = resumeExecutionBudget(s.session, 100)!;
  expect(check.payload).toEqual([{ type: "budget_check", data: { goalId: "goal", windowId: 0 } }]);
  expect(s.session.executionBudget).toMatchObject({ globalAllowance: 100, globalUsed: 5, localUsed: 5 });
  expect(resumeExecutionBudget(s.session, 100)).toBeUndefined();
});

test("staging is uncharged, failed persistence cannot release, rejected commit is terminal", () => {
  const s = setup(); const queue = new TaskQueue(); const orchestrator = new InternalTaskOrchestrator(queue);
  orchestrator.setReleaseGuard(task => s.release(task));
  const owner = s.task("prediction"); orchestrator.beginTask(owner);
  orchestrator.scheduleConversation("s", "c", owner.id, undefined, undefined, owner.id);
  expect(s.session.executionBudget?.globalUsed).toBe(0);
  s.failSave();
  expect(orchestrator.commitTask(owner.id)).toBe(false);
  expect(queue.size).toBe(0);
  expect(s.session.executionBudget?.globalUsed).toBe(0);
});

test("durable round IDs suppress replay; Topic changes and compression never erase budgets", () => {
  const s = setup(); const task = s.task(); s.release(task);
  const state = s.session.exportState({ checkpointRevision: 1, status: "active", archives: { segmentCount: 0, archivedMessageCount: 0, latestMessageCount: 1, nextSegment: 1 } });
  const restored = SessionContext.restore(state, s.session.messages);
  restored.resetForNewTopic("same-business-topic");
  expect(prepareBudgetRelease({ session: restored, task, limits, save: () => true, report() {}, notify() {} })).toBeUndefined();
  expect(restored.executionBudget?.globalUsed).toBe(1);
  startExecutionGoal(restored, "new-goal", "another task in same Topic", 200);
  expect(restored.executionBudget).toMatchObject({ globalUsed: 0, globalAllowance: 200, goalId: "new-goal" });
});

test("legacy session depth converts first reply and checks missing window evidence", () => {
  const s = setup(); s.session.executionBudget = undefined; s.session.legacyBudgetDepth = 3;
  expect(s.release()?.pipeline).toBe("follow-up-evaluator");
  expect(s.session.executionBudget).toMatchObject({ globalUsed: 4, localUsed: 5, legacyEvidenceMissing: true });
});

test("one committed owner releases at most one conversation", () => {
  const s = setup(); const queue = new TaskQueue(); const orchestrator = new InternalTaskOrchestrator(queue);
  orchestrator.setReleaseGuard(task => s.release(task));
  const owner = s.task("prediction"); orchestrator.beginTask(owner);
  for (let i = 0; i < 2; i++) orchestrator.scheduleConversation("s", "c", owner.id, undefined, undefined, owner.id);
  expect(orchestrator.commitTask(owner.id)).toBe(true);
  expect(queue.size).toBe(1);
  expect(s.session.executionBudget?.globalUsed).toBe(1);
});

test("restored pending health checks can be requested again without duplicate grants", () => {
  const s = setup(); for (let i = 0; i < 6; i++) s.release();
  const state = s.session.exportState({ checkpointRevision: 1, status: "active", archives: { segmentCount: 0, archivedMessageCount: 0, latestMessageCount: 1, nextSegment: 1 } });
  const restored = SessionContext.restore(state, s.session.messages);
  expect(restored.executionBudget).toMatchObject({ pause: "unknown", resuming: false, globalUsed: 5 });
  expect(resumeExecutionBudget(restored, 100)?.pipeline).toBe("follow-up-evaluator");
  expect(restored.executionBudget?.globalAllowance).toBe(100);
});

test("control-message checkpoint does not erase legacy migration count", async () => {
  const { SessionStore } = await import("./store");
  const store = new SessionStore(); const session = store.get("legacy");
  session.setChainDepth(4);
  expect(store.checkpointUserMessage("legacy", "继续")).toBe(true);
  expect(session.chainDepth).toBe(4);
});

test("crash after debit retains exact delivery parameters; explicit recovery is a new charged attempt", () => {
  const s = setup(); const original = s.task();
  original.payload.push({ type: "continuation_request", data: { kind: "resume_current", source: "rules", reason: "length",
    followUp: { summary: "exact summary", nextPrompt: "specific next content", avoidRepeat: "delivered sections" } } });
  s.release(original);
  const state = s.session.exportState({ checkpointRevision: 1, status: "active", archives: { segmentCount: 0, archivedMessageCount: 0, latestMessageCount: 1, nextSegment: 1 } });
  const restored = SessionContext.restore(state, s.session.messages);
  expect(restored.executionBudget?.globalUsed).toBe(1);
  const retry = resumeExecutionBudget(restored, 100)!;
  expect(retry.id).not.toBe(original.id);
  expect(retry.payload).toEqual(original.payload);
  expect(prepareBudgetRelease({ session: restored, task: retry, limits, save: () => true, report() {}, notify() {} })).toEqual(retry);
  expect(restored.executionBudget).toMatchObject({ globalUsed: 2, globalAllowance: 100 });
});

test("direct scheduled or external roots own a new budget rather than inheriting a previous goal", () => {
  const s = setup(1); s.release(); s.release();
  const next = createTaskItem({ sessionId: "s", chatId: "c", pipeline: "conversation", source: TaskSource.EXTERNAL,
    payload: [{ type: "text", data: "explicit next goal" }] });
  expect(s.release(next)).toEqual(next);
  expect(s.session.executionBudget).toMatchObject({ goalId: next.id, goal: "explicit next goal", globalUsed: 1, globalAllowance: 100 });
});
