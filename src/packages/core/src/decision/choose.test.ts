import { expect, test } from "bun:test";
import { chooseDecision } from "./choose";
import type { DecisionRequest } from "./choose";

const questions = { continuation: { type: "choice" as const, instructions: "Choose a continuation", criteria: {
  resume_current: "Continue", reconcile_progress: "Check progress",
} } };

test("actual LLM simulation validates choices and limits the output to 512 tokens", async () => {
  let sent: any;
  let observed: DecisionRequest | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    sent = await request.json();
    return Response.json({ id: "choice", object: "chat.completion", created: 1, model: "local",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ answers: { continuation: "resume_current" } }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  } });
  try {
    const model = { type: "llm" as const, apiKey: "local-test", model: "local", baseUrl: server.url.toString() };
    const result = await chooseDecision({ state: {}, questions, model, fallback: model, maxTokens: 512, maxRetries: 0,
      onRequest: request => { observed = request; } });
    expect(result.source).toBe("llm");
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(result.choices.continuation?.choice).toBe("resume_current");
    expect(sent.max_tokens).toBe(512);
    expect(observed).toMatchObject({ source: "llm", model: "local", state: {}, questions, maxTokens: 512, maxRetries: 0 });
    expect(JSON.parse(sent.messages.at(-1).content)).toEqual({ state: observed!.state, questions: observed!.questions });
    expect(JSON.stringify(observed)).not.toContain("local-test");
    expect(observed).not.toHaveProperty("baseUrl");
  } finally { server.stop(true); }
});

test("request diagnostics match the native JEV body without provider credentials", async () => {
  let sent: any;
  const observed: DecisionRequest[] = [];
  const model = { type: "jev" as const, apiKey: "secret-sentinel", model: "native", baseUrl: "https://local.example.test/decisions" };
  const result = await chooseDecision({ state: { todoAfter: [{ content: "文明", status: "in_progress" }] }, questions, model, fallback: model,
    onRequest: request => observed.push(request), fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init.body));
      return Response.json({ model: "native", answers: { continuation: { type: "choice", choice: "resume_current",
        probabilities: { resume_current: 1, reconcile_progress: 0 }, confidence: 1 } } });
    } });
  expect(result.source).toBe("jev");
  expect(observed).toEqual([{ source: "jev", ...sent }]);
  expect(JSON.stringify(observed)).not.toContain("secret-sentinel");
  expect(observed[0]).not.toHaveProperty("maxTokens");
});

test("request diagnostics identify the selected fallback and omit unavailable requests", async () => {
  const observed: DecisionRequest[] = [];
  const model = { type: "jev" as const, apiKey: "", model: "unavailable" };
  const fallback = { apiKey: "fallback-secret", model: "fallback" };
  await chooseDecision({ state: {}, questions, model, fallback, maxRetries: 0,
    onRequest: request => observed.push(request), simulate: async () => ({ continuation: "reconcile_progress" }) });
  expect(observed).toEqual([{ source: "llm", model: "fallback", state: {}, questions, maxTokens: 512, maxRetries: 0 }]);
  await expect(chooseDecision({ state: {}, questions, model, fallback: model,
    onRequest: request => observed.push(request) })).rejects.toThrow("no decision model API key");
  expect(observed).toHaveLength(1);
});

test("arbitration simulation does not retry provider errors", async () => {
  let calls = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    calls++;
    return Response.json({ error: { message: "rate limited" } }, { status: 429 });
  } });
  try {
    const model = { type: "llm" as const, apiKey: "local-test", model: "local", baseUrl: server.url.toString() };
    await expect(chooseDecision({ state: {}, questions, model, fallback: model, maxRetries: 0 })).rejects.toThrow();
    expect(calls).toBe(1);
  } finally { server.stop(true); }
});

test("test proxy queue wait precedes each decision timeout", async () => {
  let calls = 0;
  const model = { type: "llm" as const, apiKey: "test", model: "local",
    beforeCall: async () => { await new Promise(resolve => setTimeout(resolve, 30)); } };
  const result = await chooseDecision({ state: {}, questions, model, fallback: model, timeoutMs: 10,
    simulate: async () => { calls++; return { continuation: "resume_current" }; } });
  expect(calls).toBe(1);
  expect(result.source).toBe("llm");
});
