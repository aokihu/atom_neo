import { contextRows as rows } from "../../../context/test-helpers";
import { describe, expect, test } from "bun:test";
import { BusEvents } from "@atom-neo/shared";
import { ContextService } from "../../../context/context-service";
import { SessionContext } from "../../../session/context";
import { ToolRecordStore } from "../../../tools/tool-record-store";
import { makeBus } from "../../test-helpers";
import { CollectContextElement } from "./collect-context";
import { RecordContextElement } from "./record-context";

function makeContextService(bus: ReturnType<typeof makeBus>) {
  const service = new ContextService(bus, { sweepIntervalMs: 0 });
  service.start();
  return service;
}

function makeSession() {
  return {
    sessionId: "s1",
    pendingPrediction: { difficulty: "easy" },
    tokenUsage: { total: 0 },
    currentTopic: "knowledge.weather.typhoon",
  };
}

async function buildSnapshot(params: {
  session?: any;
  taskIntent?: string;
  getCompiledPrompt?: () => string;
  skillService?: any;
  toolRecordStore?: ToolRecordStore;
}, input: any, bus = makeBus(), contextService = makeContextService(bus)) {
  const record = new RecordContextElement({
    name: "record-context",
    kind: "transform",
    bus,
    contextService,
    ...params,
  });
  const collect = new CollectContextElement({
    name: "collect-context",
    kind: "transform",
    bus,
    contextService,
    configContextLimit: 100_000,
  });
  const recorded = await record.doProcess(input);
  const result = await collect.doProcess(recorded);
  return { contextService, result };
}

describe("conversation context pipeline", () => {
  test("does not add automatic Memory results to Context", async () => {
    const { result } = await buildSnapshot(
      { session: makeSession(), taskIntent: "conversation" },
      { mode: "streaming", task: { id: "t1" } },
    );

    expect(rows(result.contextSnapshot).some(row => row.source === "memory")).toBe(false);
  });

  test("context-collect only reads the service and does not consume one-shot entries", async () => {
    const session = new SessionContext("s1");
    session.pendingPrediction = { difficulty: "easy" };
    session.resetForNewTopic("topic-a");
    const bus = makeBus();
    const contextService = makeContextService(bus);
    contextService.put({
      scope: "topic",
      owner: { sessionId: "s1", topicId: "topic-a" },
      entry: {
        key: "evaluator-suggestion",
        source: "evaluator",
        channel: "instructions",
        trust: "trusted",
        priority: 850,
        consumeOnCommit: true,
        content: "retry with evidence",
      },
    });

    const { result } = await buildSnapshot(
      { session },
      { mode: "streaming", task: { id: "t1" } },
      bus,
      contextService,
    );

    expect(rows(result.contextSnapshot).some(row => row.content === "retry with evidence")).toBe(true);
    expect(contextService.get(
      "topic",
      { sessionId: "s1", topicId: "topic-a" },
      "evaluator-suggestion",
    )).toBeDefined();
  });

  test("removes legacy tool history before compiling a new snapshot", async () => {
    const session = new SessionContext("s1");
    session.pendingPrediction = { difficulty: "easy" };
    const bus = makeBus();
    const contextService = makeContextService(bus);
    contextService.put({
      scope: "session",
      owner: { sessionId: "s1" },
      entry: {
        key: "tool-history",
        source: "tool-runtime",
        channel: "messages",
        trust: "untrusted",
        priority: 500,
        content: [{ role: "assistant", content: "webfetch: error" }],
      },
    });

    const { result } = await buildSnapshot(
      { session },
      { mode: "streaming", task: { id: "t1" } },
      bus,
      contextService,
    );

    expect(contextService.get("session", { sessionId: "s1" }, "tool-history")).toBeUndefined();
    expect(rows(result.contextSnapshot).some(row => String(row.content).includes("webfetch: error"))).toBe(false);
  });

  test("compiles bounded ToolRecord summaries through the Context TOON path", async () => {
    const session = new SessionContext("s1");
    session.pendingPrediction = { difficulty: "easy" };
    const toolRecordStore = new ToolRecordStore();
    const group = toolRecordStore.beginGroup("s1", "conversation-previous", "knowledge.weather");
    toolRecordStore.append(group, {
      modelStep: 1,
      batchIndex: 0,
      toolCallId: "call-1",
      toolName: "weather",
      source: "mcp",
      startedAt: 1,
      durationMs: 2,
      input: { cities: Array.from({ length: 40 }, (_, index) => `city-${index}`) },
      output: Array.from({ length: 40 }, (_, index) => `forecast-${index}`),
      metadata: { ok: true, effect: "reference" },
    });
    toolRecordStore.seal(group);

    const { result } = await buildSnapshot({ session, toolRecordStore }, {
      mode: "streaming",
      task: { id: "conversation-current" },
    });
    const row = rows(result.contextSnapshot).find(item => item.source === "tool-record-store");
    const content = JSON.stringify(row?.content);

    expect(row?.channel).toBe("tool");
    expect(content).toContain(group.id);
    expect(content).toContain(`${group.id}-1`);
    expect(content).toContain("list(40)");
    expect(content).not.toContain("forecast-39");
  });

  test("compiles all matching scopes into one immutable lean snapshot", async () => {
    const session = new SessionContext("s1");
    session.pendingPrediction = { difficulty: "easy" };
    const { result } = await buildSnapshot({
      session,
      getCompiledPrompt: () => "workspace rules",
      skillService: { buildContext: () => "topic skill", getRevision: () => 3 },
    }, {
      mode: "streaming",
      task: { id: "t1", payload: [{ data: "current request" }] },
      prompts: [{ role: "assistant", content: "previous answer" }],
    });

    expect(result.mode).toBe("formatted");
    const contextRows = rows(result.contextSnapshot);
    expect(result.contextSnapshot?.content).toContain("workspace rules");
    expect(result.contextSnapshot?.content).toContain("topic skill");
    expect(contextRows.some(row => row.content === "previous answer")).toBe(false);
    expect(contextRows.some(row => row.content === "current request")).toBe(false);
    expect(result.userMessages?.map(message => message.content)).toEqual([
      "previous answer",
      "current request",
    ]);
    expect(Object.keys(result.contextSnapshot ?? {})).toEqual([
      "id", "content",
    ]);
    expect(Object.isFrozen(result.contextSnapshot)).toBe(true);
  });

  test("does not duplicate a user message already checkpointed in the session", async () => {
    const { result } = await buildSnapshot({ session: makeSession() }, {
      mode: "streaming",
      task: { id: "t1", payload: [{ data: "current request" }] },
      prompts: [{ role: "user", content: "current request" }],
    });

    expect(result.userMessages?.map(message => message.content)).toEqual(["current request"]);
  });

  test("keeps historical Assistant reasoning for a continuation", async () => {
    const { result } = await buildSnapshot({ session: makeSession() }, {
      mode: "streaming",
      task: { id: "t1" },
      prompts: [
        { role: "user", content: "写世界文明史" },
        { role: "assistant", content: "第一段", reasoning_content: "thinking" },
      ],
    });

    expect(result.userMessages).toEqual([
      { role: "user", content: "写世界文明史" },
      { role: "assistant", content: "第一段", reasoning_content: "thinking" },
    ]);
  });
});
