import type { TaskItem, TaskState } from "./types/task";
import type { PipelineResult, TransportEventIdentity } from "./types/pipeline";

// Client → Core
export type ClientEvent =
  | {
      type: "event.task.submit";
      payload: TaskSubmitPayload;
    }
  | {
      type: "event.task.cancel";
      payload: { taskId: string };
    };

export type TaskSubmitPayload = {
  sessionId: string;
  chatId: string;
  pipeline: string;
  source: "external";
  data: { text: string };
};

// Core → Client (broadcast)
export type ServerEvent =
  | {
      type: "event.pipeline.element.started";
      payload: ElementStartedPayload;
    }
  | {
      type: "event.pipeline.element.finished";
      payload: ElementFinishedPayload;
    }
  | {
      type: "event.transport.reason";
      payload: TransportReasonPayload;
    }
  | {
      type: "event.transport.delta";
      payload: TransportDeltaPayload;
    }
  | {
      type: "event.transport.tool.started";
      payload: ToolStartedPayload;
    }
  | {
      type: "event.transport.tool.finished";
      payload: ToolFinishedPayload;
    }
  | {
      type: "event.transport.tool.step-finished";
      payload: ToolStepFinishedPayload;
    }
  | {
      type: "event.transport.tool.group-complete";
      payload: ToolGroupCompletePayload;
    }
  | {
      type: "event.task.completed";
      payload: TaskCompletedPayload;
    }
  | {
      type: "event.task.failed";
      payload: TaskFailedPayload;
    }
  | {
      type: "event.task.state-changed";
      payload: TaskStatePayload;
    }
  | {
      type: "event.pipeline.replay-start";
      payload: ReplayStartPayload;
    }
  | {
      type: "event.pipeline.replay-end";
      payload: ReplayEndPayload;
    };

export type ElementStartedPayload = {
  pipelineName: string;
  elementName: string;
  elementKind: string;
};

export type ElementFinishedPayload = {
  pipelineName: string;
  elementName: string;
  elementKind: string;
  durationMs: number;
};

export type TransportReasonPayload = TransportEventIdentity & {
  textDelta: string;
  offset: number;
};

export type TransportDeltaPayload = TransportEventIdentity & {
  textDelta: string;
  offset: number;
};

export type ToolStartedPayload = TransportEventIdentity & {
  toolName: string;
  toolCallId: string;
  input: unknown;
};

export type ToolFinishedPayload = TransportEventIdentity & {
  toolName: string;
  toolCallId: string;
  result?: unknown;
  error?: unknown;
};

export type ToolStepFinishedPayload = TransportEventIdentity & {
  stepNumber: number;
  total: number;
  success: number;
  failed: number;
  toolNames: string[];
};

export type ToolGroupCompletePayload = TransportEventIdentity & {
  total: number;
  success: number;
  failed: number;
  toolNames: string[];
};

export type TaskCompletedPayload = {
  taskId: string;
  result: PipelineResult;
};

export type TaskFailedPayload = {
  taskId: string;
  rootTaskId: string;
  error: string;
};

export type TaskStatePayload = {
  taskId: string;
  currentState: TaskState;
};

export type ReplayStartPayload = {
  taskId: string;
  eventCount: number;
};

export type ReplayEndPayload = {
  taskId: string;
  durationMs: number;
};
