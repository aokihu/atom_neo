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

function makeSession(memoryQuery: string) {
  return {
    sessionId: "s1",
    pendingPrediction: { difficulty: "easy", memoryQuery },
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
  memory?: any;
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
  test("records Prediction Memory summaries as untrusted messages", async () => {
    let searchQuery = "";
    const memory = {
      search: async (query: string) => {
        searchQuery = query;
        return [{
          id: "abcdef123456",
          content: "查询台风信息时使用 Typhoon Skill。",
          summary: "台风查询方法",
          tags: ["skill", "typhoon"],
        }];
      },
    };
    const { result } = await buildSnapshot(
      { memory, session: makeSession("台风"), taskIntent: "conversation" },
      { mode: "streaming", task: { id: "t1" } },
    );

    expect(searchQuery).toBe("台风");
    expect(result.memorySearchStatus).toBe("found");
    const memoryRow = rows(result.contextSnapshot).find(row => row.source === "memory");
    const snapshotText = String(memoryRow?.content ?? "");
    expect(memoryRow?.trust).toBe("untrusted");
    expect(snapshotText).toContain('<MemorySummary id="abcdef" tags="skill,typhoon">');
    expect(snapshotText).toContain("台风查询方法");
    expect(snapshotText).not.toContain("Typhoon Skill");
  });

  test("records an unavailable Memory search without failing the pipeline", async () => {
    const bus = makeBus();
    const events: Record<string, unknown>[] = [];
    bus.on(BusEvents.Element.Data, event => events.push(event.payload));
    const { result } = await buildSnapshot({
      memory: { search: async () => { throw new Error("memory unavailable"); } },
      session: makeSession("台风"),
    }, { mode: "streaming", task: { id: "t1" } }, bus);

    expect(result.memorySearchAttempted).toBe(true);
    expect(result.memorySearchStatus).toBe("unavailable");
    expect(events.some(event => event.step === "memory-search-error")).toBe(true);
  });

  test("skips Memory when Prediction has no query", async () => {
    let called = false;
    const { result } = await buildSnapshot({
      memory: { search: async () => { called = true; return []; } },
      session: makeSession(""),
    }, { mode: "streaming", task: { id: "t1" } });

    expect(called).toBe(false);
    expect(result.memorySearchStatus).toBe("not_started");
  });

  test("context-collect only reads the service and does not consume one-shot entries", async () => {
    const session = new SessionContext("s1");
    session.pendingPrediction = { difficulty: "easy", memoryQuery: "" };
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

  test("compiles all matching scopes into one immutable lean snapshot", async () => {
    const session = new SessionContext("s1");
    session.pendingPrediction = { difficulty: "easy", memoryQuery: "" };
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
});
