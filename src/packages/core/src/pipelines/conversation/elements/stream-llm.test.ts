import { describe, expect, test } from "bun:test";
import { decode } from "@toon-format/toon";
import {
  injectToolContext,
  resolveModelInput,
  resolveMCPToolMetadata,
  resolveTokenMetrics,
  summarizeToolEffects,
  wrapMCPAiTools,
} from "./stream-llm";

import { ContextService } from "../../../context/context-service";
import { makeBus } from "../../test-helpers";
import { ToolCallLedger } from "../../../tools/governance";

test("keeps cumulative model usage separate from the current context window", () => {
  expect(resolveTokenMetrics(
    { totalTokens: 200 },
    { totalTokens: 1_000 },
  )).toEqual({ contextTokens: 200, totalUsageTokens: 1_000 });
});

test("uses the TOON Snapshot only as system text", () => {
  const userMessages = [{ role: "user", content: "current request" }];

  expect(resolveModelInput({
    contextSnapshot: { id: "snapshot-1", content: "context[1]{content}:\n  workspace rules" },
    systemText: "legacy system",
    userMessages,
  })).toEqual({
    systemText: "context[1]{content}:\n  workspace rules",
    userMessages,
  });
});

test("wrapMCPAiTools records success and failure for transport completion", async () => {
  const statuses = new Map<string, any[]>();
  const wrapped = wrapMCPAiTools({
    weather: { execute: async () => ({ temperature: 20 }) },
    broken: { execute: async () => { throw new Error("offline"); } },
  }, () => {}, { count: 0 }, statuses, { current: new ToolCallLedger({ maxExecutions: 10 }) });

  expect(await wrapped.weather.execute({})).toEqual({ temperature: 20 });
  expect(statuses.get("weather")).toEqual([{
    content: "{\"temperature\":20}",
    metadata: { ok: true, effect: "reference" },
  }]);

  expect(await wrapped.broken.execute({})).toBe("MCP tool error: offline");
  expect(statuses.get("broken")).toEqual([{
    content: "",
    metadata: { ok: false, effect: "none", error: "offline" },
  }]);
});

test("resolveMCPToolMetadata uses MCP structure instead of natural-language guessing", () => {
  expect(resolveMCPToolMetadata({ isError: true, content: [{ type: "text", text: "offline" }] }))
    .toEqual({ ok: false, effect: "none", error: "MCP tool returned isError" });
  expect(resolveMCPToolMetadata({ content: [{ type: "text", text: "   " }] }))
    .toEqual({ ok: true, effect: "none" });
  expect(resolveMCPToolMetadata({ content: [], structuredContent: { count: 1 } }))
    .toEqual({ ok: true, effect: "reference" });
});

test("wrapMCPAiTools blocks duplicate execution through the shared ledger", async () => {
  let executions = 0;
  const statuses = new Map<string, any[]>();
  const wrapped = wrapMCPAiTools({
    weather: { execute: async () => ({ temperature: ++executions }) },
  }, () => {}, { count: 0 }, statuses, { current: new ToolCallLedger({ maxExecutions: 10 }) });

  expect(await wrapped.weather.execute({ city: "Hangzhou" })).toEqual({ temperature: 1 });
  expect(await wrapped.weather.execute({ city: "Hangzhou" }))
    .toContain("Do not repeat this tool call");
  expect(executions).toBe(1);
  expect(statuses.get("weather")?.at(-1)?.metadata).toMatchObject({
    ok: false,
    error: "TOOL_GOVERNANCE_BLOCKED [duplicate_request]",
  });
});

describe("Tool effect summaries", () => {
  test("summarizes framework effects without reading content", () => {
    expect(summarizeToolEffects([
      { ok: true, effect: "evidence" },
      { ok: true, effect: "reference" },
      { ok: true, effect: "state_changed" },
      { ok: true, effect: "none" },
      { ok: false, effect: "none", error: "offline" },
    ])).toEqual({
      evidence: 1,
      referenceEvidence: 1,
      stateChanged: 1,
      none: 1,
      failed: 1,
    });
  });
});

describe("persistent tool context", () => {
  test("keeps an explicitly injected TTL Memory in the current topic", () => {
    const bus = makeBus();
    const contextService = new ContextService(bus, { sweepIntervalMs: 0 });
    contextService.start();
    const injection = {
      scope: "topic" as const,
      entry: {
        key: "memory:abcdef",
        source: "memory",
        channel: "messages" as const,
        trust: "untrusted" as const,
        priority: 650,
        content: [{ role: "assistant", content: "persistent memory" }],
        expiresAt: Date.now() + 60_000,
      },
    };

    expect(injectToolContext({
      contextService,
      injection,
      sessionId: "s1",
      topicId: "topic-a",
    })).toBe("topic");

    const snapshot = contextService.createSnapshot({ sessionId: "s1", topicId: "topic-a" });
    contextService.commitSnapshot(snapshot.id);
    const data = decode(snapshot.content) as { context: Array<Record<string, unknown>> };
    expect(data.context[0]?.content).toBe("persistent memory");
    expect(contextService.get(
      "topic",
      { sessionId: "s1", topicId: "topic-a" },
      "memory:abcdef",
    )).toBeDefined();
  });

  test("falls back to session scope when there is no active topic", () => {
    const bus = makeBus();
    const contextService = new ContextService(bus, { sweepIntervalMs: 0 });
    contextService.start();
    const scope = injectToolContext({
      contextService,
      sessionId: "s1",
      injection: {
        scope: "topic",
        entry: {
          key: "memory:abcdef",
          source: "memory",
          channel: "messages",
          trust: "untrusted",
          priority: 650,
          content: [{ role: "assistant", content: "persistent memory" }],
          expiresAt: Date.now() + 60_000,
        },
      },
    });

    expect(scope).toBe("session");
    expect(contextService.get("session", { sessionId: "s1" }, "memory:abcdef")).toBeDefined();
  });

  test("keeps pinned Memory at session scope even when a topic is active", () => {
    const contextService = new ContextService(makeBus(), { sweepIntervalMs: 0 });
    contextService.start();
    const scope = injectToolContext({
      contextService,
      sessionId: "s1",
      topicId: "topic-a",
      injection: {
        scope: "session",
        entry: {
          key: "memory:address",
          source: "memory",
          channel: "messages",
          trust: "untrusted",
          priority: 650,
          pinned: true,
          content: [{ role: "assistant", content: "family address" }],
        },
      },
    });

    expect(scope).toBe("session");
    expect(contextService.get("session", { sessionId: "s1" }, "memory:address")?.pinned).toBe(true);
    expect(contextService.get(
      "topic",
      { sessionId: "s1", topicId: "topic-a" },
      "memory:address",
    )).toBeUndefined();
  });

  test("renews the expiry when the same TTL Memory is injected again", () => {
    const contextService = new ContextService(makeBus(), { sweepIntervalMs: 0 });
    contextService.start();
    const inject = (expiresAt: number) => injectToolContext({
      contextService,
      sessionId: "s1",
      topicId: "topic-a",
      injection: {
        scope: "topic",
        entry: {
          key: "memory:weather",
          source: "memory",
          channel: "messages",
          trust: "untrusted",
          priority: 650,
          expiresAt,
          content: [{ role: "assistant", content: "weather workflow" }],
        },
      },
    });

    inject(100);
    inject(200);

    const owner = { sessionId: "s1", topicId: "topic-a" };
    expect(contextService.get("topic", owner, "memory:weather")?.revision).toBe(2);
    expect(contextService.get("topic", owner, "memory:weather")?.expiresAt).toBe(200);
    contextService.sweepExpired(150);
    expect(contextService.get("topic", owner, "memory:weather")).toBeDefined();
    contextService.sweepExpired(200);
    expect(contextService.get("topic", owner, "memory:weather")).toBeUndefined();
  });
});
