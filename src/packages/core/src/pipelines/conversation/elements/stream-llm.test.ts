import { contextRows } from "../../../context/test-helpers";
import { describe, expect, test } from "bun:test";
import {
  injectToolContext,
  resolveModelInput,
  resolveMCPToolMetadata,
  resolveTokenMetrics,
  resolveCacheMetrics,
  shouldRecordToolResult,
  summarizeToolEffects,
  wrapMCPAiTools,
} from "./stream-llm";

import { ContextService } from "../../../context/context-service";
import { makeBus } from "../../test-helpers";
import { ToolCallLedger } from "../../../tools/governance";
import type { Message } from "./types";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { streamText } from "ai";

test("distinguishes unknown cache usage from a measured zero hit", () => {
  expect(resolveCacheMetrics()).toEqual({ inputTokens: null, cacheReadTokens: null,
    noCacheTokens: null, outputTokens: null });
  expect(resolveCacheMetrics({ inputTokens: 100, outputTokens: 5,
    inputTokenDetails: { cacheReadTokens: 0, noCacheTokens: 100 } })).toEqual({
    inputTokens: 100, cacheReadTokens: 0, noCacheTokens: 100, outputTokens: 5,
  });
});

test("keeps cumulative model usage separate from the current context window", () => {
  expect(resolveTokenMetrics(
    { totalTokens: 200 },
    { totalTokens: 1_000 },
  )).toEqual({ contextTokens: 200, totalUsageTokens: 1_000 });
});

test("uses the TOON Snapshot only as system text", () => {
  const userMessages: Message[] = [{ role: "user", content: "current request" }];

  const result = resolveModelInput({
    contextSnapshot: { id: "snapshot-1", content: "context[1]{content}:\n  workspace rules" },
    systemText: "legacy system",
    userMessages,
  });
  expect(result.systemText).toBe("context[1]{content}:\n  workspace rules");
  expect(result.userMessages).toEqual([{ role: "user", content: "current request" }]);
});

test("converts historical Assistant reasoning into AI SDK message parts", () => {
  expect(resolveModelInput({ userMessages: [
    { role: "user", content: "写世界文明史" },
    { role: "assistant", content: "第一段", reasoning_content: "thinking" },
  ] }).userMessages).toEqual([
    { role: "user", content: "写世界文明史" },
    { role: "assistant", content: [
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "第一段" },
    ] },
  ]);
});

test("DeepSeek receives historical reasoning_content in a continuation request", async () => {
  let request: any;
  const testFetch = async (_url: URL | RequestInfo, init?: RequestInit) => {
    request = JSON.parse(String(init?.body));
    const chunk = { id: "test", object: "chat.completion.chunk", created: 1,
      model: "deepseek-flash", choices: [{ index: 0,
        delta: { role: "assistant", content: "继续" }, finish_reason: "stop" }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
      { headers: { "Content-Type": "text/event-stream" } });
  };
  const provider = createDeepSeek({ apiKey: "local-test-only", fetch: testFetch as typeof fetch });
  const result = streamText({ model: provider("deepseek-flash"),
    messages: resolveModelInput({ userMessages: [
      { role: "user", content: "写世界文明史" },
      { role: "assistant", content: "第一段", reasoning_content: "thinking" },
    ] }).userMessages });

  expect(await result.text).toBe("继续");
  expect(request.messages.at(-1)).toMatchObject({
    role: "assistant", content: "第一段", reasoning_content: "thinking",
  });
});

test("records only real Tool executions and excludes history query Tools", () => {
  expect(shouldRecordToolResult(undefined, { ok: true, effect: "reference" })).toBe(true);
  expect(shouldRecordToolResult(undefined, {
    ok: false,
    effect: "none",
    error: "backend unavailable",
    errorSource: "tool",
  })).toBe(true);
  expect(shouldRecordToolResult(undefined, {
    ok: false,
    effect: "none",
    error: "mixed Tool names",
    errorSource: "guard",
  })).toBe(false);
  expect(shouldRecordToolResult(undefined, {
    ok: false,
    effect: "none",
    error: "missing executor metadata",
    errorSource: "runtime",
  })).toBe(false);
  expect(shouldRecordToolResult({ recordPolicy: "exclude" }, { ok: true, effect: "reference" })).toBe(false);
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
    rawOutput: { temperature: 20 },
    metadata: { ok: true, effect: "reference" },
    startedAt: expect.any(Number),
    durationMs: expect.any(Number),
  }]);

  expect(await wrapped.broken.execute({})).toBe("MCP tool error: offline");
  expect(statuses.get("broken")).toEqual([{
    content: "",
    metadata: { ok: false, effect: "none", error: "offline", errorSource: "tool" },
    startedAt: expect.any(Number),
    durationMs: expect.any(Number),
  }]);
});

test("resolveMCPToolMetadata uses MCP structure instead of natural-language guessing", () => {
  expect(resolveMCPToolMetadata({ isError: true, content: [{ type: "text", text: "offline" }] }))
    .toEqual({ ok: false, effect: "none", error: "MCP tool returned isError", errorSource: "tool" });
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
      { ok: false, effect: "none", error: "offline", errorSource: "tool" },
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
    const data = { context: contextRows(snapshot) };
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
