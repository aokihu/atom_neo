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
    Reason: "transport.reason",
    ToolStarted: "transport.tool.started",
    ToolFinished: "transport.tool.finished",
    ToolStepFinished: "transport.tool.step-finished",
    ToolGroupComplete: "transport.tool.group-complete",
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
  Session: {
    Started: "session.started",
    Closed: "session.closed",
  },
} as const;

export const WsMessages = {
  Client: {
    TaskSubmit: "event.task.submit",
    TaskCancel: "event.task.cancel",
    Compact: "event.task.compact",
  },
  Server: {
    SessionReady: "session.ready",
    TaskCreated: "event.task.created",
    TaskCompleted: "event.task.completed",
    TaskFailed: "event.task.failed",
    TaskStateChanged: "event.task.state-changed",
    TransportDelta: "event.transport.delta",
    TransportReason: "event.transport.reason",
    TransportToolStarted: "event.transport.tool.started",
    TransportToolFinished: "event.transport.tool.finished",
    TransportToolStepFinished: "event.transport.tool.step-finished",
    TransportToolGroupComplete: "event.transport.tool.group-complete",
    SessionTaskActive: "event.session.task-active",
    MCPConnected: "event.mcp.connected",
    MCPToolStatus: "event.mcp.tool.status",
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
