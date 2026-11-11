import { BusEvents } from "../constants/events";
import type { ContinuationDecision, TaskItem } from "./task";

export enum PipelineResultType {
  Complete = "complete",
  Enqueue = "enqueue",
  SuspendAndEnqueueChild = "suspend_and_enqueue_child",
  ResumeParentAndEnqueue = "resume_parent_and_enqueue",
}

export enum PipelineEnqueueTransition {
  FollowUp = "follow_up",
  Dispatch = "dispatch",
}

export type PipelineResult =
  | { type: typeof PipelineResultType.Complete; task: TaskItem; output?: string; completedGoalId?: string }
  | {
      type: typeof PipelineResultType.Enqueue;
      transition: PipelineEnqueueTransition;
      task: TaskItem;
      nextTask: TaskItem;
    }
  | {
      type: typeof PipelineResultType.SuspendAndEnqueueChild;
      task: TaskItem;
      childTask: TaskItem;
    }
  | {
      type: typeof PipelineResultType.ResumeParentAndEnqueue;
      task: TaskItem;
      parentTaskId: string;
      nextTask: TaskItem;
    };

export type FlowState = { mode: string };

export type ConversationContinuationAction = "follow_up" | "continue_todo" | "reconcile_todo";
export type ConversationChainAction = ConversationContinuationAction | "post_check_retry";
export type TransportEventIdentity = {
  sessionId: string;
  taskId: string;
};
export type ReportedTransportEvent<T extends Record<string, unknown>> = {
  name: string;
  payload: TransportEventIdentity & T;
};

/**
 * Envelope produced by `BaseElement.report()` and by elements that emit
 * conversation control events directly through `bus.emit`.
 */
export type ReportedEvent<T> = {
  name: string;
  payload: T;
};

/**
 * Event envelope audit:
 * - element.state-changed / element.data: reported `{ name, payload }`
 * - pipeline.* / task.* / intent.* / session.* / context.* / replay.*: flat payloads
 * - transport.*: reported `{ name, payload }` with session/task identity
 * - conversation.chain / conversation.idle: reported `{ name, payload }`
 */
export type PipelineEventMap = {
  [BusEvents.Element.StateChanged]: ReportedEvent<{ state: "READY" | "WORKING" | "DONE" | "FAILED" }>;
  [BusEvents.Pipeline.ElementStarted]: {
    pipelineName: string;
    elementName: string;
    elementKind: string;
  };
  [BusEvents.Pipeline.ElementFinished]: {
    pipelineName: string;
    elementName: string;
    elementKind: string;
    durationMs: number;
  };
  [BusEvents.Pipeline.ElementFailed]: {
    pipelineName: string;
    elementName: string;
    elementKind: string;
    durationMs: number;
    error: unknown;
  };
  [BusEvents.Element.Data]: ReportedEvent<Record<string, unknown>>;
};

export type CoreEventMap = {
  [BusEvents.Task.Enqueued]: { task: TaskItem };
  [BusEvents.Task.Activated]: { task: TaskItem };
  [BusEvents.Task.Completed]: { task: TaskItem; result: PipelineResult };
  [BusEvents.Task.Committed]: { task: TaskItem; result: PipelineResult };
  [BusEvents.Task.Failed]: { task: TaskItem; error: unknown };
  [BusEvents.Pipeline.Result]: { task: TaskItem; result: PipelineResult };
};

export type DomainEventMap = {
  [BusEvents.Intent.Parsed]: {
    parsedCount: number;
    safeCount: number;
    rejectedCount: number;
  };
  [BusEvents.Transport.Reason]: ReportedTransportEvent<{ textDelta: string; offset: number }>;
  [BusEvents.Transport.Delta]: ReportedTransportEvent<{ textDelta: string; offset: number }>;
  [BusEvents.Transport.ToolStarted]: ReportedTransportEvent<{
    toolName: string;
    toolCallId: string;
    input: unknown;
  }>;
  [BusEvents.Transport.ToolFinished]: ReportedTransportEvent<{
    toolName: string;
    toolCallId: string;
    result?: unknown;
    error?: unknown;
  }>;
  [BusEvents.Transport.ToolStepFinished]: ReportedTransportEvent<{
    stepNumber: number;
    total: number;
    success: number;
    failed: number;
    toolNames: string[];
  }>;
  [BusEvents.Transport.ToolGroupComplete]: ReportedTransportEvent<{
    total: number;
    success: number;
    failed: number;
    toolNames: string[];
  }>;
  [BusEvents.Transport.Failed]: { error: unknown };
  [BusEvents.Conversation.Chain]: ReportedEvent<{
    sessionId: string;
    chatId: string;
    parentTaskId: string;
    ownerTaskId?: string;
    action: ConversationChainAction;
    continuation?: ContinuationDecision;
  }>;
  [BusEvents.Conversation.Idle]: ReportedEvent<{
    sessionId: string;
    chatId: string;
    parentTaskId: string;
    ownerTaskId?: string;
  }>;
  [BusEvents.Session.Started]: { sessionId: string };
  [BusEvents.Session.Closed]: { sessionId: string };
  [BusEvents.Replay.Start]: { taskId: string; eventCount: number };
  [BusEvents.Replay.End]: { taskId: string; durationMs: number };
  [BusEvents.Context.CoreStopped]: Record<string, never>;
  [BusEvents.Context.WorkspaceChanged]: { workspaceId: string; previousWorkspaceId?: string };
  [BusEvents.Context.WorkspaceClosed]: { workspaceId: string };
  [BusEvents.Context.TopicChanged]: { sessionId: string; previousTopicId?: string; topicId: string };
  [BusEvents.Context.StepCompleted]: { sessionId: string; taskId: string; stepId: string };
  [BusEvents.Context.SnapshotCommit]: { snapshotId: string };
  [BusEvents.Context.SnapshotRelease]: { snapshotId: string };
};

export type FullEventMap = PipelineEventMap & CoreEventMap & DomainEventMap;
