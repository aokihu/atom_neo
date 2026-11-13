/**
 * Task lifecycle contract tests: checkpoint-failure rollback and chain/idle dispatch.
 */
import { describe, expect, test } from "bun:test";
import { BusEvents, Logger, PipelineEventBus, TaskSource, TaskState, WsMessages } from "@atom-neo/shared";
import type { FullEventMap, TaskItem } from "@atom-neo/shared";
import { registerTaskLifecycle } from "./task-lifecycle";
import { TaskQueue } from "./task-queue";
import { createTaskItem } from "./task-factory";
import { SessionContext } from "./session/context";
import type { ExecutionBudget } from "./session/types";
import type { SessionStore } from "./session/store";
import type { Broadcaster } from "./ws/broadcaster";
import type { InternalTaskOrchestrator } from "./task/internal-task-orchestrator";

type Broadcast = { sessionId: string; type: string; payload: any };
type ContinuationCall = {
  sessionId: string;
  chatId: string;
  parentTaskId: string;
  ownerTaskId?: string;
  continuation?: unknown;
  fallbackPrompt?: string;
};
type PostConversationCall = { sessionId: string; chatId: string; parentTaskId: string; ownerTaskId?: string };

function harness(options: { session: SessionContext; budget?: ExecutionBudget; saveResult: boolean }) {
  const bus = new PipelineEventBus<FullEventMap>();
  const handlerErrors: unknown[] = [];
  bus.onHandlerError((eventName, error) => handlerErrors.push({ eventName, error }));

  const taskQueue = new TaskQueue();
  const logs: any[] = [];
  const logger = new Logger("debug", entry => logs.push(entry));
  const broadcasts: Broadcast[] = [];
  const broadcastsToSession = (sessionId: string, type: string, payload: unknown) => {
    broadcasts.push({ sessionId, type, payload });
  };
  const broadcaster = { broadcastToSession: broadcastsToSession } as unknown as Broadcaster;

  const calls = {
    discarded: [] as string[],
    committed: [] as string[],
    continuations: [] as ContinuationCall[],
    postConversations: [] as PostConversationCall[],
  };
  const orchestrator = {
    beginTask: () => {},
    discardTask: (taskId: string) => { calls.discarded.push(taskId); },
    commitTask: (taskId: string) => { calls.committed.push(taskId); return false; },
    scheduleContinuation: (
      sessionId: string, chatId: string, parentTaskId: string, ownerTaskId?: string,
      continuation?: unknown, fallbackPrompt?: string,
    ) => {
      calls.continuations.push({ sessionId, chatId, parentTaskId, ownerTaskId, continuation, fallbackPrompt });
    },
    schedulePostConversation: (sessionId: string, chatId: string, parentTaskId: string, ownerTaskId?: string) => {
      calls.postConversations.push({ sessionId, chatId, parentTaskId, ownerTaskId });
    },
  } as unknown as InternalTaskOrchestrator;

  const sessionStore = {
    get: () => options.session,
    save: () => options.saveResult,
    acquireTask: () => {},
    releaseTask: () => {},
  } as unknown as SessionStore;

  const sessionRef: { current: { sessionId: string; chatId: string } | null } = { current: null };
  registerTaskLifecycle({ bus, logger, taskQueue, orchestrator, sessionStore, broadcaster, sessionRef });

  return { bus, taskQueue, logs, broadcasts, calls, handlerErrors, sessionRef };
}

function taskFor(pipeline = "conversation"): TaskItem {
  const task = createTaskItem({
    sessionId: "s1",
    chatId: "chat",
    pipeline,
    source: TaskSource.EXTERNAL,
    payload: [{ type: "text", data: "hello" }],
  });
  task.state = TaskState.PROCESSING;
  return task;
}

function budgetFor(task: TaskItem): ExecutionBudget {
  return {
    goalId: "goal-1",
    goal: "hello",
    globalUsed: 1,
    globalAllowance: 4,
    localUsed: 1,
    windowId: 1,
    windowStartSeq: 1,
    goalStartSeq: 1,
    todoBaseline: [],
    releasedTaskIds: [task.id],
    completed: true,
    lastReleasedTask: task,
  };
}

describe("task lifecycle", () => {
  test("rolls back assistant message, token usage and budget when the completion checkpoint fails", () => {
    const session = new SessionContext("s1");
    session.addMessage({ role: "user", content: "hello", timestamp: 1 });
    session.addTokenUsage(100);
    const task = taskFor();
    const budget = budgetFor(task);
    const budgetBefore: ExecutionBudget = {
      goalId: "goal-1", goal: "hello", globalUsed: 0, globalAllowance: 4, localUsed: 0,
      windowId: 1, windowStartSeq: 1, goalStartSeq: 1, todoBaseline: [], releasedTaskIds: [],
    };
    const h = harness({ session, budget, saveResult: false });

    h.bus.emit(BusEvents.Task.Completed, {
      task,
      result: {
        type: "complete",
        task,
        responseText: "assistant reply",
        tokenUsage: { total: 40 },
        budgetBefore,
      },
    } as any);

    expect(h.handlerErrors).toEqual([]);
    expect(session.messages.filter(message => message.role === "assistant")).toEqual([]);
    expect(session.tokenUsage.total).toBe(100);
    expect(session.executionBudget).toBe(budgetBefore);
    expect(session.executionBudget?.completed).toBeUndefined();
    expect(session.executionBudget?.pause).toBe("unknown");
    expect(session.executionBudget?.resuming).toBe(false);
    expect(budget.completed).toBe(true);
    expect(budget.lastReleasedTask).toBe(task);
    expect(h.taskQueue.getStatus(task.id)?.state).toBe(TaskState.FAILED);
    expect(h.calls.discarded).toContain(task.id);
    expect(h.logs.some(entry => entry.message === "session checkpoint failed after task completion")).toBe(true);
    expect(h.broadcasts.some(b => b.type === WsMessages.Server.TaskFailed)).toBe(true);
    expect(h.broadcasts.find(b => b.type === WsMessages.Server.SessionTaskActive)?.payload)
      .toMatchObject({ active: false, taskId: task.id });
  });

  test("dispatches conversation.chain after a successful checkpoint", () => {
    const session = new SessionContext("s1");
    const task = taskFor();
    const h = harness({ session, saveResult: true });

    h.bus.emit(BusEvents.Task.Completed, {
      task,
      result: {
        type: "complete",
        task,
        output: "answer",
        responseText: "answer",
        chainAction: "follow_up",
        continuationDecision: { kind: "resume_current" },
      },
    } as any);

    expect(h.handlerErrors).toEqual([]);
    expect(h.calls.continuations).toEqual([{
      sessionId: "s1",
      chatId: "chat",
      parentTaskId: task.parentTaskId ?? task.id,
      ownerTaskId: task.id,
      continuation: { kind: "resume_current" },
      fallbackPrompt: undefined,
    }]);
    expect(h.calls.committed).toEqual([task.id]);
    expect(h.calls.discarded).toEqual([]);
    expect(h.taskQueue.getStatus(task.id)?.state).toBe(TaskState.COMPLETED);
    expect(h.broadcasts.find(b => b.type === WsMessages.Server.TaskCompleted)?.payload)
      .toMatchObject({ taskId: task.id, terminal: true });
  });

  test("dispatches conversation.idle when the post-check is requested", () => {
    const session = new SessionContext("s1");
    const task = taskFor();
    const h = harness({ session, saveResult: true });

    h.bus.emit(BusEvents.Task.Completed, {
      task,
      result: { type: "complete", task, output: "answer", shouldPostCheck: true },
    } as any);

    expect(h.handlerErrors).toEqual([]);
    expect(h.calls.postConversations).toEqual([{
      sessionId: "s1",
      chatId: "chat",
      parentTaskId: task.parentTaskId ?? task.id,
      ownerTaskId: task.id,
    }]);
    expect(h.calls.continuations).toEqual([]);
  });
});
