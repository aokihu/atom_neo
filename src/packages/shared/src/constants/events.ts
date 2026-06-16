export const BusEvents = {
  Element: {
    StateChanged: "element.state-changed",
    Data: "element.data",
  },
  Pipeline: {
    ElementStarted: "pipeline.element.started",
    ElementFinished: "pipeline.element.finished",
    ElementFailed: "pipeline.element.failed",
    Result: "pipeline.result",
  },
  Task: {
    Enqueued: "task.enqueued",
    Activated: "task.activated",
    Completed: "task.completed",
    Failed: "task.failed",
  },
  Transport: {
    Delta: "transport.delta",
    ToolStarted: "transport.tool.started",
    ToolFinished: "transport.tool.finished",
    ToolStepFinished: "transport.tool.step-finished",
    Failed: "transport.failed",
  },
  Intent: {
    Parsed: "intent.parsed",
  },
  Replay: {
    Start: "event.pipeline.replay-start",
    End: "event.pipeline.replay-end",
  },
  Conversation: {
    Chain: "conversation.chain",
    Idle: "conversation.idle",
  },
} as const;

export const WsMessages = {
  Client: {
    TaskSubmit: "event.task.submit",
    TaskCancel: "event.task.cancel",
  },
  Server: {
    SessionReady: "session.ready",
    TaskCreated: "event.task.created",
    TaskCompleted: "event.task.completed",
    TaskFailed: "event.task.failed",
    TaskStateChanged: "event.task.state-changed",
    TransportDelta: "event.transport.delta",
    TransportToolStarted: "event.transport.tool.started",
    TransportToolFinished: "event.transport.tool.finished",
    TransportToolStepFinished: "event.transport.tool.step-finished",
    PipelineElementStarted: "event.pipeline.element.started",
    PipelineElementFinished: "event.pipeline.element.finished",
    ReplayStart: "event.pipeline.replay-start",
    ReplayEnd: "event.pipeline.replay-end",
  },
  Control: {
    Ping: "ping",
    Pong: "pong",
    Error: "error",
  },
} as const;
