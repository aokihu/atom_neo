import { expect, test } from "bun:test";
import { z } from "zod";
import { BusEvents } from "@atom-neo/shared";
import { ContextService } from "../../../context/context-service";
import { SessionContext } from "../../../session/context";
import { makeBus } from "../../test-helpers";
import { StreamLLMElement } from "./stream-llm";

// Real SDK transport against loopback only: no credentials or external model requests.
test.each([false, true])("refreshes bounded snapshots and settles the actual step (failure=%s)", async fail => {
  const bus = makeBus();
  const service = new ContextService(bus, { sweepIntervalMs: 0 });
  service.start();
  const session = new SessionContext("cache-session");
  const owner = { sessionId: session.sessionId, taskId: "cache-task" };
  const events: Record<string, any>[] = [];
  bus.on(BusEvents.Element.Data, event => events.push(event.payload));
  service.put({ scope: "system", entry: { key: "rules", source: "prompt-registry",
    channel: "instructions", trust: "trusted", format: "text", pinned: true,
    priority: 1000, content: "Stable rules\nKeep this prefix." } });
  service.put({ scope: "task", owner, entry: { key: "task-state", source: "task-state",
    channel: "runtime", trust: "trusted", priority: 700, content: { todos: [] } } });
  const initial = service.createSnapshot({ ...owner, inputBudget: 100 });
  const requests: any[] = [];
  let revision = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    requests.push(await request.json());
    if (requests.length > 1 && fail) return Response.json({ error: { message: "test failure" } }, { status: 400 });
    const delta = requests.length === 1 ? {
      role: "assistant", tool_calls: [{ index: 0, id: "call-1", type: "function",
        function: { name: "update", arguments: "{}" } }],
    } : { role: "assistant", content: "Done <<<COMPLETE>>>" };
    const chunk = { id: "test", object: "chat.completion.chunk", created: 1, model: "cache-test",
      choices: [{ index: 0, delta, finish_reason: null }] };
    const end = { ...chunk, choices: [{ index: 0, delta: {},
      finish_reason: requests.length === 1 ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105,
        prompt_cache_hit_tokens: 60, prompt_cache_miss_tokens: 40 } };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`,
      { headers: { "Content-Type": "text/event-stream" } });
  } });
  try {
    const element = new StreamLLMElement({ name: "stream-llm", kind: "transform", bus,
      apiKey: "local-test-only", model: "cache-test", baseUrl: server.url.toString(),
      contextService: service, session, maxTokens: 100, maxSteps: 3,
      skillService: { list: () => [], load: () => ({ ok: true }), loadSection: () => true,
        removeSection: () => true, unload: () => {}, getRevision: () => revision, buildContext: () => revision ? "Skill\nInspect evidence." : "" },
      tools: [{ name: "update", source: "builtin", description: "Update test state", inputSchema: z.object({}),
        execute: async () => {
          revision++;
          session.setTodoState([{ content: "Verify", status: "in_progress", priority: "high" }]);
          service.put({ scope: "session", owner: { sessionId: session.sessionId }, entry: {
            key: "hint", source: "post-conversation", channel: "messages", trust: "untrusted",
            priority: 800, consumeOnCommit: true, content: "One shot evidence" } });
          service.put({ scope: "session", owner: { sessionId: session.sessionId }, entry: {
            key: "large", source: "memory", channel: "messages", trust: "untrusted",
            priority: 1, content: "large ".repeat(1000) } });
          return { content: "updated", metadata: { ok: true, effect: "state_changed" } };
        } }],
    });
    await element.doProcess({ mode: "formatted", task: { id: owner.taskId, sessionId: owner.sessionId },
      contextOwner: owner, contextSnapshot: initial, userMessages: [{ role: "user", content: "Run test" }] });
    expect(requests).toHaveLength(2);
    expect(requests[1].messages[0].content).toContain("Skill\nInspect evidence.");
    expect(requests[1].messages[0].content).toContain("in_progress");
    expect(requests[1].messages[0].content).not.toContain("large large");
    const refreshed = events.find(event => event.step === "step-snapshot-created")!;
    expect(refreshed?.inputBudget).toBe(100);
    expect(service.inspectSnapshot(refreshed.snapshotId)?.status).toBe(fail ? "released" : "committed");
    expect(Boolean(service.get("session", { sessionId: session.sessionId }, "hint"))).toBe(fail);
    const usage = events.filter(event => event.step === "model-step-usage");
    expect(usage[0]).toMatchObject({ cacheReadTokens: 60, noCacheTokens: 40, inputTokens: 100, outputTokens: 5 });
    expect(service.inspectSnapshot(initial.id)?.status).toBe("committed");
  } finally {
    server.stop(true);
    service.stop();
  }
});
