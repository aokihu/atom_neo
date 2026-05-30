import type { TaskItem } from "./task";

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
  | { type: typeof PipelineResultType.Complete; task: TaskItem }
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

export type PipelineEventMap = {
  "element.state-changed": {
    name: string;
    payload: { state: "READY" | "WORKING" | "DONE" | "FAILED" };
  };
  "pipeline.element.started": {
    pipelineName: string;
    elementName: string;
    elementKind: string;
  };
  "pipeline.element.finished": {
    pipelineName: string;
    elementName: string;
    elementKind: string;
    durationMs: number;
  };
  "pipeline.element.failed": {
    pipelineName: string;
    elementName: string;
    elementKind: string;
    durationMs: number;
    error: unknown;
  };
  "element.data": {
    name: string;
    payload: Record<string, unknown>;
  };
};

export type CoreEventMap = {
  "task.enqueued": { task: TaskItem };
  "task.activated": { task: TaskItem };
  "task.completed": { task: TaskItem; result: PipelineResult };
  "task.failed": { task: TaskItem; error: unknown };
  "pipeline.result": { task: TaskItem; result: PipelineResult };
};

export type DomainEventMap = {
  "intent.parsed": {
    parsedCount: number;
    safeCount: number;
    rejectedCount: number;
  };
  "transport.delta": { textDelta: string };
  "transport.tool.started": {
    toolName: string;
    toolCallId: string;
    input: unknown;
  };
  "transport.tool.finished": {
    toolName: string;
    toolCallId: string;
    result?: unknown;
    error?: unknown;
  };
  "transport.failed": { error: unknown };
  "conversation.chain": {
    sessionId: string;
    chatId: string;
    parentTaskId: string;
    action: "follow_up" | "more_tools";
  };
};

export type FullEventMap = PipelineEventMap & CoreEventMap & DomainEventMap;
