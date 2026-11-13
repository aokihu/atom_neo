import { describe, expect, test } from "bun:test";
import { BusEvents, EVENTS, WsMessages } from "./events";

function leafValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(entry => leafValues(entry));
  }
  return [];
}

describe("event catalog", () => {
  test("BusEvents snapshot", () => {
    expect(BusEvents).toEqual({
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
        Committed: "task.committed",
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
      Context: {
        CoreStopped: "context.core.stopped",
        WorkspaceChanged: "context.workspace.changed",
        WorkspaceClosed: "context.workspace.closed",
        TopicChanged: "context.topic.changed",
        StepCompleted: "context.step.completed",
        SnapshotCommit: "context.snapshot.commit",
        SnapshotRelease: "context.snapshot.release",
      },
    });
  });

  test("WsMessages snapshot", () => {
    expect(WsMessages).toEqual({
      Client: {
        TaskSubmit: "event.task.submit",
        TaskCancel: "event.task.cancel",
        Compact: "event.task.compact",
      },
      Server: {
        SessionReady: "session.ready",
        SessionTelemetry: "event.session.telemetry",
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
        DecisionUpdated: "event.decision.updated",
        ReplayStart: "event.pipeline.replay-start",
        ReplayEnd: "event.pipeline.replay-end",
      },
      Control: {
        Ping: "ping",
        Pong: "pong",
        Error: "error",
      },
    });
  });

  test("declares every wire string once in EVENTS", () => {
    const values = leafValues(EVENTS);
    expect(values).toHaveLength(new Set(values).size);
    expect(values.every(value => typeof value === "string" && value.length > 0)).toBe(true);
  });

  test("views have no duplicate values and only reference EVENTS", () => {
    const catalog = new Set(leafValues(EVENTS));
    for (const view of [BusEvents, WsMessages]) {
      const values = leafValues(view);
      expect(values).toHaveLength(new Set(values).size);
      expect(values.every(value => catalog.has(value))).toBe(true);
    }
  });

  test("keeps stable key paths", () => {
    expect(BusEvents.Element.StateChanged).toBe(EVENTS.Element.StateChanged);
    expect(BusEvents.Pipeline.ElementStarted).toBe(EVENTS.Pipeline.ElementStarted);
    expect(BusEvents.Task.Enqueued).toBe(EVENTS.Task.Enqueued);
    expect(BusEvents.Transport.Delta).toBe(EVENTS.Transport.Delta);
    expect(BusEvents.Conversation.Chain).toBe(EVENTS.Conversation.Chain);
    expect(BusEvents.Context.TopicChanged).toBe(EVENTS.Context.TopicChanged);
    expect(WsMessages.Client.TaskSubmit).toBe(EVENTS.Client.TaskSubmit);
    expect(WsMessages.Server.SessionReady).toBe(EVENTS.Server.SessionReady);
    expect(WsMessages.Server.ReplayStart).toBe(EVENTS.Replay.Start);
    expect(WsMessages.Control.Ping).toBe(EVENTS.Control.Ping);
  });
});
