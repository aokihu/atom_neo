import { describe, expect, test } from "bun:test";
import { decode } from "@toon-format/toon";
import { BusEvents } from "@atom-neo/shared";
import type { ContextSnapshot } from "@atom-neo/shared";
import { ContextService } from "../../../context/context-service";
import { SessionContext } from "../../../session/context";
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

function rows(snapshot?: ContextSnapshot): Array<Record<string, unknown>> {
  if (!snapshot) return [];
  return (decode(snapshot.content) as { context: Array<Record<string, unknown>> }).context;
}

async function buildSnapshot(params: {
  session?: any;
  taskIntent?: string;
  getCompiledPrompt?: () => string;
  skillService?: any;
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
    expect(contextRows.some(row => row.content === "workspace rules")).toBe(true);
    expect(contextRows.some(row => row.content === "topic skill")).toBe(true);
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
});
