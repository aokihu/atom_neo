/**
 * HTTP router contract tests: health, admin rejection, task submission delegation, upgrade, 404.
 */
import { describe, expect, mock, test } from "bun:test";
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
    requestShutdown: () => {},
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

  test("attach accepts an explicit sessionId for History open", async () => {
    const restored = { sessionId: "session-history", lastTuiUsedAt: 0 };
    const attached: string[] = [];
    const route = createHttpRouter(routerDeps({
      sessionStore: {
        attachSession: (id: string) => {
          attached.push(id);
          return id === "session-history" ? restored : null;
        },
      } as unknown as SessionStore,
    }));
    const ok = await route.fetch(request("/api/tui/attach", {
      method: "POST",
      headers: { "x-atom-admin-token": "secret", "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-history" }),
    }), ctx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ sessionId: "session-history" });
    expect(attached).toEqual(["session-history"]);

    const missing = await route.fetch(request("/api/tui/attach", {
      method: "POST",
      headers: { "x-atom-admin-token": "secret", "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "missing" }),
    }), ctx);
    expect(missing.status).toBe(404);
  });

  test("attach without admin auth returns 403 without reloading config", async () => {
    const reloadConfig = mock(() => ({}));
    const route = createHttpRouter(routerDeps({
      runtime: {
        sandbox: "/tmp/atom",
        appConfig: {},
        maxTokens: 100,
        getResolvedModel: () => ({ provider: "local", protocol: "deepseek", model: "local", apiKey: "test" }),
        reloadConfig,
      },
    }));
    const response = await route.fetch(request("/api/tui/attach", { method: "POST", body: "{}" }), ctx);
    expect(response.status).toBe(403);
    expect(reloadConfig).not.toHaveBeenCalled();
  });

  test("attach reloads config from disk before building serverInfo", async () => {
    const runtime: any = {
      sandbox: "/tmp/atom",
      appConfig: { tui: { theme: "github-dark" } },
      maxTokens: 100,
      getResolvedModel: () => ({ provider: "local", protocol: "deepseek", model: "local", apiKey: "test" }),
      reloadConfig: mock(() => {
        runtime.appConfig = { tui: { theme: "tokyo-night" } };
        return runtime.appConfig;
      }),
    };
    const route = createHttpRouter(routerDeps({
      runtime,
      sessionStore: { attachTui: () => ({ sessionId: "session-reload" }) } as unknown as SessionStore,
    }));
    const response = await route.fetch(request("/api/tui/attach", {
      method: "POST",
      headers: { "x-atom-admin-token": "secret", "Content-Type": "application/json" },
      body: "{}",
    }), ctx);
    expect(response.status).toBe(200);
    expect(runtime.reloadConfig).toHaveBeenCalledTimes(1);
    expect((await response.json() as any).serverInfo.theme).toBe("tokyo-night");
  });

  test("attach still succeeds with the old theme when config reload fails", async () => {
    const warn = mock(() => {});
    const runtime: any = {
      sandbox: "/tmp/atom",
      appConfig: { tui: { theme: "github-dark" } },
      maxTokens: 100,
      getResolvedModel: () => ({ provider: "local", protocol: "deepseek", model: "local", apiKey: "test" }),
      reloadConfig: () => { throw new Error("bad config"); },
    };
    const route = createHttpRouter(routerDeps({
      runtime,
      logger: { warn } as any,
      sessionStore: { attachTui: () => ({ sessionId: "session-reload-failed" }) } as unknown as SessionStore,
    }));
    const response = await route.fetch(request("/api/tui/attach", {
      method: "POST",
      headers: { "x-atom-admin-token": "secret", "Content-Type": "application/json" },
      body: "{}",
    }), ctx);
    expect(response.status).toBe(200);
    expect((await response.json() as any).serverInfo.theme).toBe("github-dark");
    expect(warn).toHaveBeenCalledWith("tui attach config reload failed", { error: "bad config" });
  });

  test("attach persistence failures return 500 and do not mark attached", async () => {
    const route = createHttpRouter(routerDeps({
      sessionStore: {
        attachSession: () => { throw new Error("Failed to persist TUI session"); },
      } as unknown as SessionStore,
    }));
    const response = await route.fetch(request("/api/tui/attach", {
      method: "POST",
      headers: { "x-atom-admin-token": "secret", "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-history" }),
    }), ctx);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to persist TUI session" });
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

  test("lists sessions only with admin auth", async () => {
    const summaries = [{
      sessionId: "tui-1",
      lastTuiUsedAt: 1760000000000,
      initiator: { type: "tui" as const },
      status: "suspended",
      active: false,
      attached: false,
    }];
    const route = createHttpRouter(routerDeps({
      sessionStore: { listSessions: () => summaries } as unknown as SessionStore,
    }));
    expect((await route.fetch(request("/api/sessions"), ctx)).status).toBe(403);
    const response = await route.fetch(request("/api/sessions", {
      headers: { "x-atom-admin-token": "secret" },
    }), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summaries);
  });

  test("session detail and delete require admin and protect attached sessions", async () => {
    let deleted = 0;
    const route = createHttpRouter(routerDeps({
      sessionStore: {
        load: () => ({ sessionId: "s1", messages: [] }),
        delete: () => { deleted++; return false; },
      } as unknown as SessionStore,
    }));
    expect((await route.fetch(request("/api/sessions/s1"), ctx)).status).toBe(403);
    expect((await route.fetch(request("/api/sessions/s1", { method: "DELETE" }), ctx)).status).toBe(403);
    const detail = await route.fetch(request("/api/sessions/s1", {
      headers: { "x-atom-admin-token": "secret" },
    }), ctx);
    expect(detail.status).toBe(200);
    const removed = await route.fetch(request("/api/sessions/s1", {
      method: "DELETE",
      headers: { "x-atom-admin-token": "secret" },
    }), ctx);
    expect(removed.status).toBe(409);
    expect(await removed.json()).toEqual({ error: "Session is active or attached" });
    expect(deleted).toBe(1);
  });
});

describe("admin shutdown", () => {
  test("rejects shutdown without the admin token", async () => {
    let calls = 0;
    const route = createHttpRouter(routerDeps({ requestShutdown: () => { calls++; } }));
    const response = await route.fetch(request("/api/admin/shutdown", { method: "POST" }), ctx);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    await Promise.resolve();
    expect(calls).toBe(0);
  });

  test("returns 200 and schedules shutdown after the response", async () => {
    let calls = 0;
    const route = createHttpRouter(routerDeps({ requestShutdown: () => { calls++; } }));
    const pending = route.fetch(request("/api/admin/shutdown", {
      method: "POST",
      headers: { "x-atom-admin-token": "secret" },
    }), ctx);
    expect(calls).toBe(0);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    await Bun.sleep(5);
    expect(calls).toBe(1);
  });

  test("returns 503 without scheduling shutdown while stopping", async () => {
    let calls = 0;
    const route = createHttpRouter(routerDeps({
      isStopping: () => true,
      requestShutdown: () => { calls++; },
    }));
    const response = await route.fetch(request("/api/admin/shutdown", {
      method: "POST",
      headers: { "x-atom-admin-token": "secret" },
    }), ctx);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Core is stopping" });
    await Promise.resolve();
    expect(calls).toBe(0);
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
