import { describe, expect, test } from "bun:test";
import { WsMessages } from "./constants/events";
import * as sharedApi from "./index";
import * as protocolBarrel from "./protocol";
import {
  CLIENT_EVENT_TYPES,
  SERVER_EVENT_TYPES,
  isClientEventType,
  isServerEventType,
  type ClientEvent,
  type ClientEventType,
  type ServerEvent,
  type ServerEventPayload,
  type ServerEventType,
} from "./protocol";
import { TaskState } from "./types/task";

const CANONICAL_CLIENT_EVENT_TYPES: ClientEventType[] = [...Object.values(WsMessages.Client), WsMessages.Control.Ping];
const CANONICAL_SERVER_EVENT_TYPES: ServerEventType[] = [
  ...Object.values(WsMessages.Server),
  WsMessages.Control.Pong,
  WsMessages.Control.Error,
];

const taskFailedPayload: ServerEventPayload<typeof WsMessages.Server.TaskFailed> = {
  taskId: "t1",
  rootTaskId: "t1",
  code: "TASK_FAILED",
  error: "failed",
};

type Assert<T extends true> = T;
type MissingServerEventType = Exclude<(typeof WsMessages.Server)[keyof typeof WsMessages.Server], ServerEventType>;
type MissingClientEventType = Exclude<(typeof WsMessages.Client)[keyof typeof WsMessages.Client], ClientEventType>;

// Compile-time contract: every WsMessages entry has a protocol variant.
type ServerCoverage = Assert<MissingServerEventType extends never ? true : false>;
type ClientCoverage = Assert<MissingClientEventType extends never ? true : false>;
const serverCoverage: ServerCoverage = true;
const clientCoverage: ClientCoverage = true;

const serverEvents: ServerEvent[] = [
  {
    type: WsMessages.Server.SessionReady,
    payload: {
      sessionId: "s1",
      messages: [],
      contextTokens: 0,
      activeTaskIds: [],
      telemetry: { sessionId: "s1", rounds: null, todos: [] },
    },
  },
  {
    type: WsMessages.Server.SessionTelemetry,
    payload: { sessionId: "s1", rounds: null, todos: [] },
  },
  { type: WsMessages.Server.TaskCreated, payload: { taskId: "t1", state: TaskState.WAITING } },
  {
    type: WsMessages.Server.TaskCompleted,
    payload: {
      taskId: "t1", rootTaskId: "t1", parentTaskId: null, terminal: true, output: "", reasoningContent: "",
      tokenUsage: { total: 0 }, contextTokens: 0,
    },
  },
  { type: WsMessages.Server.TaskFailed, payload: { taskId: "t1", rootTaskId: "t1", error: "failed" } },
  { type: WsMessages.Server.TaskStateChanged, payload: { taskId: "t1", currentState: TaskState.CANCELLED } },
  { type: WsMessages.Server.TransportDelta, payload: { sessionId: "s1", taskId: "t1", textDelta: "x", offset: 0 } },
  { type: WsMessages.Server.TransportReason, payload: { sessionId: "s1", taskId: "t1", textDelta: "x", offset: 0 } },
  {
    type: WsMessages.Server.TransportToolStarted,
    payload: { sessionId: "s1", taskId: "t1", toolName: "read", toolCallId: "c1", input: {} },
  },
  {
    type: WsMessages.Server.TransportToolFinished,
    payload: { sessionId: "s1", taskId: "t1", toolName: "read", toolCallId: "c1", result: "ok" },
  },
  {
    type: WsMessages.Server.TransportToolStepFinished,
    payload: { sessionId: "s1", taskId: "t1", stepNumber: 1, total: 1, success: 1, failed: 0, toolNames: ["read"] },
  },
  {
    type: WsMessages.Server.TransportToolGroupComplete,
    payload: { sessionId: "s1", taskId: "t1", total: 1, success: 1, failed: 0, toolNames: ["read"] },
  },
  { type: WsMessages.Server.SessionTaskActive, payload: { active: true, taskId: "t1" } },
  { type: WsMessages.Server.MCPConnected, payload: { servers: [], toolInfos: [] } },
  { type: WsMessages.Server.MCPToolStatus, payload: { servers: [] } },
  {
    type: WsMessages.Server.PipelineElementStarted,
    payload: { pipelineName: "conversation", elementName: "stream", elementKind: "transform" },
  },
  {
    type: WsMessages.Server.PipelineElementFinished,
    payload: { pipelineName: "conversation", elementName: "stream", elementKind: "transform", durationMs: 1 },
  },
  {
    type: WsMessages.Server.DecisionUpdated,
    payload: { sessionId: "s1", taskId: "t1", rootTaskId: "t1", purpose: "prediction", source: "jev", state: "run" },
  },
  { type: WsMessages.Server.ReplayStart, payload: { taskId: "t1", eventCount: 1 } },
  { type: WsMessages.Server.ReplayEnd, payload: { taskId: "t1", durationMs: 1 } },
  { type: WsMessages.Control.Pong, payload: {} },
  { type: WsMessages.Control.Error, payload: { message: "bad", code: "INVALID_PAYLOAD" } },
];

const clientEvents: ClientEvent[] = [
  { type: WsMessages.Client.TaskSubmit, payload: { data: { text: "hello" } } },
  { type: WsMessages.Client.TaskCancel, payload: { taskId: "t1" } },
  { type: WsMessages.Client.Compact },
  { type: WsMessages.Control.Ping, payload: {} },
];

describe("protocol union coverage", () => {
  test("every WsMessages.Server entry has a ServerEvent variant", () => {
    const covered = new Set(serverEvents.map(event => event.type));
    for (const type of Object.values(WsMessages.Server)) expect(covered.has(type)).toBe(true);
    expect(covered.size).toBe(serverEvents.length);
  });

  test("every WsMessages.Client entry has a ClientEvent variant", () => {
    const covered = new Set(clientEvents.map(event => event.type));
    for (const type of Object.values(WsMessages.Client)) expect(covered.has(type)).toBe(true);
  });

  test("runtime type guards accept catalog values and reject unknown events", () => {
    for (const type of SERVER_EVENT_TYPES) expect(isServerEventType(type)).toBe(true);
    for (const type of CLIENT_EVENT_TYPES) expect(isClientEventType(type)).toBe(true);
    expect(isServerEventType("event.unknown")).toBe(false);
    expect(isClientEventType("event.unknown")).toBe(false);
    expect(isServerEventType(undefined)).toBe(false);
  });

  test("guards reject cross-channel event strings and non-strings", () => {
    expect(isClientEventType(WsMessages.Server.SessionReady)).toBe(false);
    expect(isServerEventType(WsMessages.Client.TaskSubmit)).toBe(false);
    expect(isClientEventType("")).toBe(false);
    expect(isServerEventType(null)).toBe(false);
  });

  test("event type catalogs preserve canonical wire strings and order", () => {
    expect<ClientEventType[]>([...CLIENT_EVENT_TYPES]).toEqual(CANONICAL_CLIENT_EVENT_TYPES);
    expect<ServerEventType[]>([...SERVER_EVENT_TYPES]).toEqual(CANONICAL_SERVER_EVENT_TYPES);
  });

  test("protocol and shared-package barrels re-export identical values", () => {
    expect(protocolBarrel.CLIENT_EVENT_TYPES).toBe(CLIENT_EVENT_TYPES);
    expect(protocolBarrel.SERVER_EVENT_TYPES).toBe(SERVER_EVENT_TYPES);
    expect(protocolBarrel.isClientEventType).toBe(isClientEventType);
    expect(protocolBarrel.isServerEventType).toBe(isServerEventType);
    expect(sharedApi.CLIENT_EVENT_TYPES).toBe(CLIENT_EVENT_TYPES);
    expect(sharedApi.SERVER_EVENT_TYPES).toBe(SERVER_EVENT_TYPES);
    expect(sharedApi.isClientEventType).toBe(isClientEventType);
    expect(sharedApi.isServerEventType).toBe(isServerEventType);
  });

  test("ServerEventPayload extracts the event-specific payload", () => {
    expect(taskFailedPayload.code).toBe("TASK_FAILED");
    expect(taskFailedPayload.error).toBe("failed");
  });

  test("compile-time coverage assertions are reachable", () => {
    expect(serverCoverage).toBe(true);
    expect(clientCoverage).toBe(true);
  });
});
