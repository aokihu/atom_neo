/**
 * HTTP router contract tests: health, admin rejection, task submission delegation, upgrade, 404.
 */
import { describe, expect, test } from "bun:test";
import type { HttpRequestContext } from "@atom-neo/shared";
import { Logger } from "@atom-neo/shared";
import { createHttpRouter, requireAdmin } from "./http-router";
import type { HttpRouterDeps } from "./http-router";
import type { SessionStore } from "./session/store";
import type { TaskQueue } from "./task-queue";
import type { TaskSubmissionService, TaskSubmitInput } from "./task/task-submission-service";

const logger = new Logger("error", () => {});

function routerDeps(overrides: Partial<HttpRouterDeps> = {}): HttpRouterDeps {
  const session = {
    sessionId: "default",
    initiator: { type: "unknown" },
    executionBudget: undefined,
    lastTuiUsedAt: 0,
  };
  return {
    logger,
    adminToken: "secret",
    host: "127.0.0.1",
    sandbox: "/tmp/atom",
    runtime: {
      sandbox: "/tmp/atom",
      appConfig: {},
      maxTokens: 100,
      getResolvedModel: () => ({ provider: "local", protocol: "deepseek", model: "local", apiKey: "test" }),
    },
    fallbackModel: { provider: "local", model: "local", apiKey: "" },
    sessionStore: {
      get: () => session,
      load: () => null,
      delete: () => true,
      isActive: () => false,
    } as unknown as SessionStore,
    taskQueue: { waiting: 1, active: 2, processing: 0 } as unknown as TaskQueue,
    taskEngine: {} as HttpRouterDeps["taskEngine"],
    taskSubmission: { submit: () => ({ id: "task-1", state: "waiting" }) } as unknown as TaskSubmissionService,
    orchestrator: {} as HttpRouterDeps["orchestrator"],
    hookManager: { list: () => [] },
    allTools: [],
    toolInfos: [],
    getMcpServerInfos: () => [],
    budgetLimits: () => ({ maxGlobalRounds: 10, maxLocalRounds: 5 }),
    isStopping: () => false,
    ...overrides,
  };
}

const ctx: HttpRequestContext = { runtime: "bun", ip: "127.0.0.1", port: 3210 };

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://127.0.0.1${path}`, init);
}

describe("http router", () => {
  test("serves health without admin auth", async () => {
    const route = createHttpRouter(routerDeps());
    const response = await route.fetch(request("/api/health"), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", queue: { waiting: 1, active: 2, processing: 0 } });
  });

  test("rejects admin-protected routes without the token", async () => {
    const route = createHttpRouter(routerDeps());
    const response = await route.fetch(request("/api/config"), ctx);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  test("allows admin-protected routes with a loopback token", async () => {
    expect(requireAdmin(request("/api/config", { headers: { "x-atom-admin-token": "secret" } }), ctx, "secret")).toBeUndefined();
    expect(requireAdmin(request("/api/config"), ctx, "secret")?.status).toBe(403);
    const route = createHttpRouter(routerDeps());
    const response = await route.fetch(request("/api/config", { headers: { "x-atom-admin-token": "secret" } }), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  test("attach reports the port from the request context", async () => {
    const route = createHttpRouter(routerDeps({
      sessionStore: {
        attachTui: () => ({ sessionId: "session-attach" }),
      } as unknown as SessionStore,
    }));
    const response = await route.fetch(request("/api/tui/attach", {
      method: "POST",
      headers: { "x-atom-admin-token": "secret", "Content-Type": "application/json" },
      body: "{}",
    }), { ...ctx, port: 3456 });
    expect(response.status).toBe(200);
    const data = await response.json() as { sessionId: string; serverInfo: { port: number } };
    expect(data.sessionId).toBe("session-attach");
    expect(data.serverInfo.port).toBe(3456);
  });

  test("delegates POST /api/tasks to the shared submission service", async () => {
    const submitted: TaskSubmitInput[] = [];
    const route = createHttpRouter(routerDeps({
      taskSubmission: {
        submit: (input: TaskSubmitInput) => {
          submitted.push(input);
          return { id: "task-1", state: "waiting" };
        },
      } as unknown as TaskSubmissionService,
    }));
    const response = await route.fetch(request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { text: "hello" } }),
    }), ctx);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ taskId: "task-1", state: "waiting" });
    expect(submitted).toEqual([{
      sessionId: "default",
      chatId: "default",
      pipeline: undefined,
      text: "hello",
      initiator: undefined,
      platform: undefined,
    }]);
  });

  test("returns 404 for unknown routes", async () => {
    const route = createHttpRouter(routerDeps());
    const response = await route.fetch(request("/api/unknown"), ctx);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });
});

describe("http router upgrade", () => {
  test("ignores non-WebSocket paths", () => {
    const route = createHttpRouter(routerDeps());
    expect(route.upgrade?.(request("/api/health"), ctx)).toBeUndefined();
  });

  test("rejects an invalid session ID with 400", async () => {
    const route = createHttpRouter(routerDeps());
    const decision = route.upgrade?.(request("/ws/"), ctx);
    expect(decision && "response" in decision).toBe(true);
    if (!decision || !("response" in decision)) throw new Error("expected an upgrade response");
    expect(decision.response.status).toBe(400);
    expect(await decision.response.json()).toEqual({ error: "Invalid session ID" });
  });

  test("accepts a valid session ID", () => {
    const route = createHttpRouter(routerDeps());
    expect(route.upgrade?.(request("/ws/session-1"), ctx)).toEqual({ data: { sessionId: "session-1" } });
  });

  test("locks /ws/ fetches that skip the upgrade", async () => {
    const route = createHttpRouter(routerDeps());
    const invalid = await route.fetch(request("/ws/"), ctx);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Invalid session ID" });
    const valid = await route.fetch(request("/ws/session-1"), ctx);
    expect(valid.status).toBe(426);
    expect(await valid.text()).toBe("Upgrade Required");
  });
});
