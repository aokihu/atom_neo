/**
 * HTTP router contract tests: health, admin rejection, task submission delegation, 404.
 */
import { describe, expect, test } from "bun:test";
import { Logger } from "@atom-neo/shared";
import { createHttpRouter, requireAdmin } from "./http-router";
import type { HttpRouterDeps, RouterServer } from "./http-router";
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

const srv: RouterServer = {
  requestIP: () => ({ address: "127.0.0.1" }),
  port: 3210,
};

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://127.0.0.1${path}`, init);
}

describe("http router", () => {
  test("serves health without admin auth", async () => {
    const route = createHttpRouter(routerDeps());
    const response = await route(request("/api/health"), srv);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ status: "ok", queue: { waiting: 1, active: 2, processing: 0 } });
  });

  test("rejects admin-protected routes without the token", async () => {
    const route = createHttpRouter(routerDeps());
    const response = await route(request("/api/config"), srv);
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "Forbidden" });
  });

  test("allows admin-protected routes with a loopback token", async () => {
    expect(requireAdmin(request("/api/config", { headers: { "x-atom-admin-token": "secret" } }), srv, "secret")).toBeUndefined();
    expect(requireAdmin(request("/api/config"), srv, "secret")?.status).toBe(403);
    const route = createHttpRouter(routerDeps());
    const response = await route(request("/api/config", { headers: { "x-atom-admin-token": "secret" } }), srv);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({});
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
    const response = await route(request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { text: "hello" } }),
    }), srv);
    expect(response?.status).toBe(201);
    expect(await response?.json()).toEqual({ taskId: "task-1", state: "waiting" });
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
    const response = await route(request("/api/unknown"), srv);
    expect(response?.status).toBe(404);
    expect(await response?.text()).toBe("Not Found");
  });
});
