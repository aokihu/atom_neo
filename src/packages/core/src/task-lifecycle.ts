/**
 * Task lifecycle handlers: Activated/Completed/Failed and conversation chain/idle scheduling.
 * This module owns the Task.Completed rollback contract (message + token usage + budget).
 */
import type {
  ContinuationDecision,
  ConversationContinuationAction,
  FullEventMap,
  Logger,
  PipelineEventBus,
  PipelineResult,
  TaskCompletedPayload,
} from "@atom-neo/shared";
import {
  BusEvents,
  TaskFailureCodes,
  TaskState,
  WsMessages,
  sanitizeForJSON,
  substringWellFormed,
} from "@atom-neo/shared";
import type { Broadcaster } from "./ws/broadcaster";
import type { InternalTaskOrchestrator } from "./task/internal-task-orchestrator";
import type { SessionStore } from "./session/store";
import type { TaskQueue } from "./task-queue";
import type { ToolEffectSummary } from "./pipelines/conversation/elements/types";
import type { ProgressTrace } from "./pipelines/shared/progress-evidence";
import { hasActiveTodos } from "./session/context";

const LOG_OUTPUT_MAX_LEN = 200;

type CompletedResult = PipelineResult & {
  budgetPauseText?: string;
  budgetBefore?: import("./session/types").ExecutionBudget;
  output?: string;
  responseText?: string;
  reasoningContent?: string;
  tokenUsage?: { total: number };
  chainAction?: ConversationContinuationAction;
  continuationDecision?: ContinuationDecision;
  progressTrace?: ProgressTrace;
  shouldPostCheck?: boolean;
  finishReason?: string;
  completeDetected?: boolean;
  toolEffectSummary?: ToolEffectSummary;
};

export function resolveTaskFailureCode(error: unknown, cancelled: boolean): string | undefined {
  if (cancelled) return TaskFailureCodes.PipelineAborted;
  return typeof (error as { code?: unknown } | null)?.code === "string"
    ? (error as { code: string }).code
    : undefined;
}

export type TaskLifecycleDeps = {
  bus: PipelineEventBus<FullEventMap>;
  logger: Logger;
  taskQueue: TaskQueue;
  orchestrator: InternalTaskOrchestrator;
  sessionStore: SessionStore;
  broadcaster: Broadcaster;
  sessionRef: { current: { sessionId: string; chatId: string } | null };
};

/** Register all task and conversation lifecycle handlers on the Core bus. */
export function registerTaskLifecycle(deps: TaskLifecycleDeps): void {
  const { bus, logger, taskQueue, orchestrator, sessionStore, broadcaster, sessionRef } = deps;

  bus.on(BusEvents.Task.Enqueued, ({ task }) => {
    if (task.sessionId) sessionStore.acquireTask(task.id, task.sessionId);
  });
  bus.on(BusEvents.Task.Activated, (p) => {
    orchestrator.beginTask(p.task);
    const sid = p.task.sessionId;
    if (sid) {
      sessionStore.acquireTask(p.task.id, sid);
      sessionRef.current = { sessionId: sid, chatId: p.task.chatId ?? "default" };
      broadcaster.broadcastToSession(sid, WsMessages.Server.SessionTaskActive, {
        active: true,
        taskId: p.task.id,
      });
    }
  });
  bus.on(BusEvents.Task.Completed, (p) => {
    const result = p.result as CompletedResult;

    logger.info("task pipeline completed", {
      taskId: p.task.id,
      output: result.output ? substringWellFormed(result.output, 0, LOG_OUTPUT_MAX_LEN) : undefined,
    });
    const sid = p.task.sessionId;
    const session = sid ? sessionStore.get(sid) : undefined;
    const tokenUsageBefore = session?.tokenUsage.total ?? 0;
    const output = sanitizeForJSON(result.responseText || result.output || "");
    const reasoningContent = result.reasoningContent || "";
    let addedMessageSeq: number | undefined;
    if (session && output) {
      const msg = {
        role: "assistant" as const,
        content: output,
        timestamp: Date.now(),
        pipeline: p.task.pipeline,
        visible: p.task.pipeline === "conversation",
        metadata: {
          finishReason: result.finishReason ?? "",
          completeDetected: result.completeDetected ?? false,
          ...(result.progressTrace ? { progress: result.progressTrace } : {}),
          ...(result.toolEffectSummary ? { toolEffectSummary: result.toolEffectSummary } : {}),
        },
        ...(reasoningContent ? { reasoningContent } : {}),
      };
      session.addMessage(msg);
      addedMessageSeq = session.messages.at(-1)?.seq;
      logger.debug("task completed: message added to session", { sessionId: sid, msgCount: session.messages.length, pipeline: p.task.pipeline });
      if (p.task.pipeline === "conversation") {
        session.markSafeMessageCount();
      }
    }
    if (session && result.tokenUsage) {
      session.addTokenUsage(result.tokenUsage.total);
    }
    const completedBudget = session?.executionBudget;
    const releasedReceipt = completedBudget?.lastReleasedTask;
    const previouslyCompleted = completedBudget?.completed;
    if (p.task.pipeline === "post-conversation" && result.type === "complete" && result.completedGoalId === completedBudget?.goalId
      && completedBudget && !completedBudget.pause && !completedBudget.pendingTask && !completedBudget.lastReleasedTask
      && session && !session.todoState.some(todo => todo.status === "pending" || todo.status === "in_progress")) {
      completedBudget.completed = true;
    }
    if (p.task.pipeline === "conversation" && releasedReceipt?.id === p.task.id) completedBudget!.lastReleasedTask = undefined;
    const checkpointed = !sid || sessionStore.save(sid, "task_completed");
    if (!checkpointed) {
      if (session && addedMessageSeq !== undefined) session.removeMessages([addedMessageSeq]);
      if (session) session.addTokenUsage(tokenUsageBefore - session.tokenUsage.total);
      if (completedBudget) completedBudget.completed = previouslyCompleted;
      if (completedBudget && releasedReceipt) completedBudget.lastReleasedTask = releasedReceipt;
      if (session && result.budgetBefore) {
        session.executionBudget = result.budgetBefore;
        result.budgetBefore.pause = "unknown"; result.budgetBefore.resuming = false;
      }
      const error = "Session checkpoint failed after task completion";
      p.task.state = TaskState.FAILED;
      taskQueue.storeResult(p.task.id, { taskId: p.task.id, state: TaskState.FAILED, error });
      logger.warn("session checkpoint failed after task completion", { sessionId: sid, taskId: p.task.id,
        rootTaskId: p.task.chainId, continuation: result.continuationDecision });
      orchestrator.discardTask(p.task.id);
      broadcaster.broadcastToSession(sid, WsMessages.Server.TaskFailed, {
        taskId: p.task.id,
        rootTaskId: p.task.chainId,
        error,
      });
      broadcaster.broadcastToSession(sid, WsMessages.Server.SessionTaskActive, {
        active: false,
        taskId: p.task.id,
      });
      return;
    }
    if (sid && result.budgetPauseText) bus.emit(BusEvents.Transport.Delta, { name: "execution-budget", payload: {
      sessionId: sid, taskId: p.task.id, textDelta: `\n\n${result.budgetPauseText}`, offset: 0,
    } });
    taskQueue.storeResult(p.task.id, { taskId: p.task.id, state: TaskState.COMPLETED, result });
    bus.emit(BusEvents.Task.Committed, { task: p.task, result: p.result });
    if (sid && (p.task.pipeline === "conversation" || result.chainAction)) {
      const payload = {
        sessionId: sid,
        chatId: p.task.chatId,
        parentTaskId: p.task.parentTaskId ?? p.task.id,
        ownerTaskId: p.task.id,
      };
      if (result.chainAction) {
        logger.debug("conversation completed: scheduling chain after persistence", { action: result.chainAction, sessionId: sid,
          taskId: p.task.id, parentTaskId: p.task.parentTaskId, rootTaskId: p.task.chainId, continuation: result.continuationDecision });
        bus.emit(BusEvents.Conversation.Chain, {
          name: "task-completed",
          payload: { ...payload, action: result.chainAction, continuation: result.continuationDecision },
        });
      } else if (p.task.pipeline === "conversation" && result.shouldPostCheck) {
        logger.debug("conversation completed: scheduling post-conversation after persistence", { sessionId: sid });
        bus.emit(BusEvents.Conversation.Idle, {
          name: "task-completed",
          payload,
        });
      }
    }
    const hasDownstreamTask = orchestrator.commitTask(p.task.id);
    if (sid) {
      const accumulated = sessionStore.get(sid).tokenUsage;
      const payload: TaskCompletedPayload = {
        taskId: p.task.id,
        rootTaskId: p.task.chainId,
        parentTaskId: p.task.parentTaskId,
        terminal: !hasDownstreamTask,
        output: result.output ?? "",
        reasoningContent,
        tokenUsage: accumulated,
        contextTokens: sessionStore.get(sid).contextTokens,
      };
      broadcaster.broadcastToSession(sid, WsMessages.Server.TaskCompleted, payload);
      broadcaster.broadcastToSession(sid, WsMessages.Server.SessionTaskActive, {
        active: false,
        taskId: p.task.id,
      });
    }
  });
  bus.on(BusEvents.Task.Failed, (p) => {
    orchestrator.discardTask(p.task.id);
    const cancelled = p.task.state === TaskState.CANCELLED;
    const budget = sessionStore.get(p.task.sessionId).executionBudget;
    if (cancelled && budget && (budget.releasedTaskIds.includes(p.task.id) || budget.goalId === p.task.chainId || p.task.pipeline === "follow-up-evaluator")) {
      budget.pause = "cancelled"; budget.resuming = false;
    } else if (budget?.pause === "health_check" && p.task.pipeline === "follow-up-evaluator") {
      budget.pause = "unknown"; budget.resuming = false;
    }
    taskQueue.storeResult(p.task.id, { taskId: p.task.id, state: p.task.state, error: String(p.error) });
    const failureCode = resolveTaskFailureCode(p.error, cancelled);
    const logContext = {
      taskId: p.task.id,
      error: substringWellFormed(String(p.error), 0, 200),
      ...(failureCode ? { code: failureCode } : {}),
    };
    if (cancelled) logger.info("task cancelled", logContext);
    else logger.error("task failed", logContext);
    const sid = p.task.sessionId;
    if (sid && !sessionStore.save(sid, "task_failed")) {
      logger.warn("session checkpoint failed after task failure", { sessionId: sid, taskId: p.task.id });
    }
    if (sid) {
      broadcaster.broadcastToSession(sid, WsMessages.Server.TaskFailed, {
        taskId: p.task.id,
        rootTaskId: p.task.chainId,
        ...(failureCode ? { code: failureCode } : {}),
        error: String(p.error),
      });
      broadcaster.broadcastToSession(sid, WsMessages.Server.SessionTaskActive, {
        active: false,
        taskId: p.task.id,
      });
    }
  });
  bus.on(BusEvents.Task.Completed, ({ task }) => {
    sessionStore.releaseTask(task.id);
  });
  bus.on(BusEvents.Task.Failed, ({ task }) => {
    sessionStore.releaseTask(task.id);
  });

  bus.on(BusEvents.Conversation.Chain, (e) => {
    const p = e.payload;
    const session = sessionStore.get(p.sessionId);
    logger.debug("conversation chain: handler entered", { sessionId: p.sessionId, action: p.action,
      taskId: p.ownerTaskId, continuation: p.continuation, budget: session.executionBudget });
    if (p.action === "continue_todo" && !hasActiveTodos(session.todoState)) return;
    if (session.pendingPrediction) session.pendingPrediction.contextRelevance = "continuation";
    orchestrator.scheduleContinuation(p.sessionId, p.chatId, p.parentTaskId, p.ownerTaskId, p.continuation,
      p.action === "continue_todo" ? "请继续执行当前 TODO；完成后更新 TODO 状态。" : undefined);
  });

  bus.on(BusEvents.Conversation.Idle, (e) => {
    const p = e.payload;
    logger.debug("conversation idle: scheduling post-conversation check", { sessionId: p.sessionId });
    orchestrator.schedulePostConversation(p.sessionId, p.chatId, p.parentTaskId, p.ownerTaskId);
  });
}
