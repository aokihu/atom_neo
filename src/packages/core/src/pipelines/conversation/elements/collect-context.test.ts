import { describe, expect, test } from "bun:test";
import { BusEvents } from "@atom-neo/shared";
import { makeBus } from "../../../pipelines/test-helpers";
import { CollectContextElement } from "./collect-context";

function makeSession(memoryQuery: string) {
  return {
    pendingPrediction: { difficulty: "easy", memoryQuery },
    tokenUsage: { total: 0 },
    toolContext: { results: [] },
    currentTopic: "knowledge.weather.typhoon",
  };
}

describe("CollectContextElement Memory discovery", () => {
  test("uses Prediction memoryQuery even when intent is conversation", async () => {
    let searchQuery = "";
    const memory = {
      search: async (query: string) => {
        searchQuery = query;
        return [{
          id: "abcdef123456",
          content: "查询台风信息时使用 Typhoon Skill。",
          tags: ["skill", "typhoon"],
          accessCount: 0,
        }];
      },
      incrementAccess: () => {},
      boostWeight: () => {},
      decayWeight: () => {},
    };
    const element = new CollectContextElement({
      name: "collect-context",
      kind: "transform",
      bus: makeBus(),
      memory,
      session: makeSession("台风"),
      taskIntent: "conversation",
    });

    const result = await element.doProcess({ mode: "streaming", task: {} });

    expect(searchQuery).toBe("台风");
    expect(result.memorySearchAttempted).toBe(true);
    expect(result.memorySearchStatus).toBe("found");
    expect(result.injectedMemoryCount).toBe(1);
    expect(result.contextData).toContain('<Memory id="abcdef" tags="skill,typhoon">');
  });

  test("records failed Memory search as attempted without failing the pipeline", async () => {
    const bus = makeBus();
    const events: Record<string, unknown>[] = [];
    bus.on(BusEvents.Element.Data, (event) => events.push(event.payload));
    const element = new CollectContextElement({
      name: "collect-context",
      kind: "transform",
      bus,
      memory: { search: async () => { throw new Error("memory unavailable"); } },
      session: makeSession("台风"),
      taskIntent: "question",
    });

    const result = await element.doProcess({ mode: "streaming", task: {} });

    expect(result.memorySearchAttempted).toBe(true);
    expect(result.memorySearchStatus).toBe("unavailable");
    expect(result.injectedMemoryCount).toBe(0);
    expect(events.some((event) => event.step === "memory-search-error")).toBe(true);
  });

  test("records an empty Memory result as attempted", async () => {
    const element = new CollectContextElement({
      name: "collect-context",
      kind: "transform",
      bus: makeBus(),
      memory: { search: async () => [] },
      session: makeSession("台风"),
      taskIntent: "question",
    });

    const result = await element.doProcess({ mode: "streaming", task: {} });

    expect(result.memorySearchAttempted).toBe(true);
    expect(result.memorySearchStatus).toBe("empty");
    expect(result.injectedMemoryCount).toBe(0);
  });

  test("does not search when Prediction has no Memory query", async () => {
    let called = false;
    const element = new CollectContextElement({
      name: "collect-context",
      kind: "transform",
      bus: makeBus(),
      memory: { search: async () => { called = true; return []; } },
      session: makeSession(""),
      taskIntent: "question",
    });

    const result = await element.doProcess({ mode: "streaming", task: {} });

    expect(called).toBe(false);
    expect(result.memorySearchAttempted).toBe(false);
    expect(result.memorySearchStatus).toBe("not_started");
    expect(result.injectedMemoryCount).toBe(0);
  });
});
