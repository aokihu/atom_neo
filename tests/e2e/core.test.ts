import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startCore } from "../../src/packages/core/src/server";
import { Logger, StdoutSink, LogHub } from "@atom-neo/shared";

let server: { port: number; tools: string[]; stop: () => void };
const BASE = "http://127.0.0.1:3200";

const mockRuntime = {
  sandbox: process.cwd() + "/sandbox",
  apiKey: "",
  mode: "core",
  port: 3200,
  host: "127.0.0.1",
  appConfig: null,
  maxTokens: 4096,
  getResolvedModel: () => ({ provider: "deepseek", model: "deepseek-chat", apiKey: "" }),
};

const mockSm = {
  get(name: string) {
    if (name === "agents-compiler") return { getCompiledPrompt: () => "" };
    return undefined;
  }
};

beforeAll(async () => {
  const hub = new LogHub();
  hub.addSink(new StdoutSink());
  const logger = new Logger("warn", (e) => hub.write(e));

  server = await startCore({
    port: 3200,
    host: "127.0.0.1",
    logger: logger as any,
    sm: mockSm,
    runtime: mockRuntime,
  });
});

afterAll(() => {
  server.stop();
});

describe("E2E: Core HTTP API", () => {
  test("GET /api/health returns ok", async () => {
    const r = await fetch(`${BASE}/api/health`);
    const body: any = await r.json();
    expect(r.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.queue.waiting).toBeGreaterThanOrEqual(0);
  });

  test("GET /api/metrics returns memory info", async () => {
    const r = await fetch(`${BASE}/api/metrics`);
    const body: any = await r.json();
    expect(body.memory).toBeDefined();
  });

  test("POST /api/tasks creates task", async () => {
    const r = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "e2e-s1",
        chatId: "e2e-c1",
        data: { text: "test message" },
      }),
    });
    const body: any = await r.json();
    expect(r.status).toBe(201);
    expect(body.taskId).toMatch(/^task-/);
    expect(body.state).toBe("waiting");
  });

  test("GET /api/sessions/:id returns messages", async () => {
    // First add a message via task
    await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "e2e-s2",
        chatId: "e2e-c2",
        data: { text: "hello" },
      }),
    });

    // Now retrieve
    const r = await fetch(`${BASE}/api/sessions/e2e-s2`);
    const messages: any[] = await r.json();
    expect(r.status).toBe(200);
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.some((m: any) => m.role === "user")).toBe(true);
  });

  test("DELETE /api/tasks/:id cancels or returns 404", async () => {
    const create = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "e2e-s3",
        chatId: "e2e-c3",
        data: { text: "cancel me" },
      }),
    });
    const { taskId }: any = await create.json();

    const r = await fetch(`${BASE}/api/tasks/${taskId}`, { method: "DELETE" });
    // Task may already be processed by TaskEngine
    expect([200, 404]).toContain(r.status);
  });

  test("404 for unknown path", async () => {
    const r = await fetch(`${BASE}/api/unknown`);
    expect(r.status).toBe(404);
  });
});
