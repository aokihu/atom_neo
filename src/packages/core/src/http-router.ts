/**
 * Core HTTP route table. Keeps the legacy if-chain order and response contracts
 * so the Bun server and the future Node adapter share one router.
 */
import type { HttpRequestContext, HttpRouter, Logger } from "@atom-neo/shared";
import type { BudgetLimits, ResolvedModel, RuntimeLike } from "./pipeline-factory";
import type { ToolInfo } from "./bootstrap";
import type { SessionStore } from "./session/store";
import type { TaskQueue } from "./task-queue";
import type { TaskEngine } from "./task-engine";
import type { TaskSubmissionService } from "./task/task-submission-service";
import type { InternalTaskOrchestrator } from "./task/internal-task-orchestrator";
import type { HookManager } from "./hooks/hook-manager";
import type { McpServerInfo } from "./mcp-lifecycle";
import { createTaskHandler, taskCancelHandler, taskStatusHandler } from "./api/tasks";
import type { TaskRequestBody } from "./api/tasks";
import { healthHandler, metricsHandler } from "./api/health";
import { configGetHandler, configPatchHandler, configResetHandler, isAdminRequest } from "./api/config";
import { decodePathParam } from "./url-path";
import { resolveContextLimit } from "./constants";
import { resumeExecutionBudget } from "./session/execution-budget";

const API_PREFIX = "/api/";
const SESSION_API_PREFIX = `${API_PREFIX}sessions/`;

export type HttpRouterDeps = {
  logger: Logger;
  adminToken?: string;
  allowRemoteAdmin?: boolean;
  version?: string;
  host: string;
  sandbox: string;
  runtime: RuntimeLike;
  fallbackModel: ResolvedModel;
  sessionStore: SessionStore;
  taskQueue: TaskQueue;
  taskEngine: TaskEngine;
  taskSubmission: TaskSubmissionService;
  orchestrator: InternalTaskOrchestrator;
  hookManager: Pick<HookManager, "list">;
  allTools: Array<{ name: string }>;
  toolInfos: ToolInfo[];
  getMcpServerInfos: () => McpServerInfo[];
  budgetLimits: () => BudgetLimits;
  isStopping: () => boolean;
};

/** Single admin gate shared by every protected route. */
export function requireAdmin(req: Request, ctx: Pick<HttpRequestContext, "ip">, adminToken?: string, allowRemoteAdmin = false): Response | undefined {
  return isAdminRequest(req, ctx, adminToken, allowRemoteAdmin)
    ? undefined
    : Response.json({ error: "Forbidden" }, { status: 403 });
}

export function createHttpRouter(deps: HttpRouterDeps): HttpRouter<{ sessionId: string }> {
  const { logger, sessionStore, taskQueue, taskEngine, taskSubmission, orchestrator, hookManager } = deps;

  async function handleTaskSubmit(req: Request): Promise<Response> {
    if (deps.isStopping()) return Response.json({ error: "Core is stopping" }, { status: 503 });
    const body = await req.json().catch(() => ({})) as TaskRequestBody;
    const normalized = {
      ...body,
      sessionId: body.sessionId ?? "default",
      chatId: body.chatId ?? "default",
    };
    const origin = body.initiator;
    if (origin !== undefined && (!origin || typeof origin !== "object")) return Response.json({ error: "Invalid initiator" }, { status: 400 });
    if (origin && (origin.type !== "tui" && origin.type !== "gateway" && origin.type !== "internal" && origin.type !== "unknown")) return Response.json({ error: "Invalid initiator" }, { status: 400 });
    if (origin?.type === "gateway" && (typeof origin.clientId !== "string" || !origin.clientId.trim() || typeof origin.platform !== "string" || !origin.platform.trim())) return Response.json({ error: "Invalid gateway initiator" }, { status: 400 });
    const session = sessionStore.get(normalized.sessionId, origin ?? { type: "unknown" });
    if (origin?.type === "gateway" && session.initiator.type !== "unknown" && (session.initiator.type !== "gateway" || session.initiator.clientId !== origin.clientId || session.initiator.platform !== origin.platform)) return Response.json({ error: "Session initiator conflict" }, { status: 409 });
    if (body.platform === "tui" && session.initiator.type === "tui") session.lastTuiUsedAt = Date.now();
    if (/^(继续|continue)$/i.test(body.data?.text ?? "") && session.executionBudget && (session.executionBudget.pause || sessionStore.isActive(session.sessionId))) {
      if (!sessionStore.checkpointUserMessage(normalized.sessionId, body.data?.text ?? "", { controlRequest: "resume_budget" })) {
        return Response.json({ error: "Failed to persist session message" }, { status: 500 });
      }
      if (!session.executionBudget.pause) return Response.json({
        taskId: session.executionBudget.releasedTaskIds.at(-1), state: "processing", reason: "already_running",
      });
      const before = structuredClone(session.executionBudget);
      const task = resumeExecutionBudget(session, deps.budgetLimits().maxGlobalRounds);
      if (!task) return Response.json({ taskId: before.pendingTask?.id, state: "suspended", reason: before.pause });
      if (!sessionStore.save(session.sessionId, "message")) {
        session.executionBudget = before;
        return Response.json({ error: "Failed to persist budget authorization" }, { status: 500 });
      }
      logger.debug("execution budget: resume-authorized", { sessionId: session.sessionId, before, after: structuredClone(session.executionBudget) });
      orchestrator.releaseTask(task);
      return Response.json({ taskId: task.id, state: task.state }, { status: 201 });
    }
    return createTaskHandler(taskSubmission, normalized);
  }

  return {
    upgrade(req) {
      const url = new URL(req.url);
      if (!url.pathname.startsWith("/ws/")) return undefined;
      const sid = decodePathParam(url.pathname, "/ws/");
      if (!sid) return { response: Response.json({ error: "Invalid session ID" }, { status: 400 }) };
      return { data: { sessionId: sid } };
    },

    async fetch(req, ctx) {
      const url = new URL(req.url);

      // Without an Upgrade request the transport cannot attach; never hang the client.
      if (url.pathname.startsWith("/ws/")) {
        return decodePathParam(url.pathname, "/ws/")
          ? new Response("Upgrade Required", { status: 426 })
          : Response.json({ error: "Invalid session ID" }, { status: 400 });
      }

      const method = req.method;

      if (url.pathname === `${API_PREFIX}tui/attach` && method === "POST") {
        const denied = requireAdmin(req, ctx, deps.adminToken, deps.allowRemoteAdmin);
        if (denied) return denied;
        if (deps.isStopping()) return Response.json({ error: "Core is stopping" }, { status: 503 });
        let options: unknown;
        try {
          const body = await req.text();
          options = body.trim() ? JSON.parse(body) : {};
        } catch {
          return Response.json({ error: "Invalid attach JSON" }, { status: 400 });
        }
        if (!options || typeof options !== "object" || Array.isArray(options)
          || ("continue" in options && typeof options.continue !== "boolean")) {
          return Response.json({ error: "continue must be a boolean" }, { status: 400 });
        }
        const session = sessionStore.attachTui("continue" in options && options.continue === true);
        const model = deps.runtime.getResolvedModel?.("balanced") ?? deps.fallbackModel;
        return Response.json({ sessionId: session.sessionId, serverInfo: {
          port: ctx.port, host: deps.host, sandbox: deps.sandbox, version: deps.version ?? "unknown", model: model.model,
          tools: deps.allTools.map(t => t.name), toolInfos: deps.toolInfos, mcpServerInfos: deps.getMcpServerInfos(),
          theme: deps.runtime.appConfig?.tui?.theme ?? "edex", thinking: model.thinking,
          contextLimit: resolveContextLimit(`${model.provider}/${model.model}`, deps.runtime.appConfig?.providers?.[model.provider]?.contextLimit),
        } });
      }
      if (url.pathname === `${API_PREFIX}health`) return healthHandler(taskQueue);
      if (url.pathname === `${API_PREFIX}metrics`) return metricsHandler(taskQueue);

      if (url.pathname === `${API_PREFIX}schedules` && method === "GET") {
        const denied = requireAdmin(req, ctx, deps.adminToken, deps.allowRemoteAdmin);
        if (denied) return denied;
        if (deps.isStopping()) return Response.json({ error: "Core is stopping" }, { status: 503 });
        return Response.json(hookManager.list().filter(h => h.trigger.type.startsWith("time:")).map(({ prompt, ...summary }) => summary));
      }

      if (url.pathname === `${API_PREFIX}config` && method === "GET") {
        const denied = requireAdmin(req, ctx, deps.adminToken, deps.allowRemoteAdmin);
        if (denied) return denied;
        return configGetHandler(deps.runtime);
      }
      if (url.pathname === `${API_PREFIX}config/runtime` && method === "PATCH") {
        const denied = requireAdmin(req, ctx, deps.adminToken, deps.allowRemoteAdmin);
        if (denied) return denied;
        return configPatchHandler(deps.runtime, req);
      }
      if (url.pathname === `${API_PREFIX}config/runtime` && method === "DELETE") {
        const denied = requireAdmin(req, ctx, deps.adminToken, deps.allowRemoteAdmin);
        if (denied) return denied;
        return configResetHandler(deps.runtime);
      }

      if (url.pathname === `${API_PREFIX}tasks` && method === "POST") return handleTaskSubmit(req);

      if (url.pathname.startsWith(SESSION_API_PREFIX) && method === "GET") {
        const sid = decodePathParam(url.pathname, SESSION_API_PREFIX);
        if (!sid) return Response.json({ error: "Invalid session ID" }, { status: 400 });
        const session = sessionStore.load(sid);
        return session
          ? Response.json(session.messages)
          : Response.json({ error: "Session not found" }, { status: 404 });
      }
      if (url.pathname.startsWith(SESSION_API_PREFIX) && method === "DELETE") {
        const sid = decodePathParam(url.pathname, SESSION_API_PREFIX);
        if (!sid) return Response.json({ error: "Invalid session ID" }, { status: 400 });
        if (!sessionStore.delete(sid)) {
          return Response.json({ error: "Session is active" }, { status: 409 });
        }
        return Response.json({ ok: true, sessionId: sid });
      }
      if (url.pathname.startsWith(`${API_PREFIX}tasks/`) && method === "DELETE") {
        const taskId = url.pathname.split("/").pop()!;
        return taskCancelHandler(taskEngine, req, taskId);
      }
      if (url.pathname.startsWith(`${API_PREFIX}tasks/`) && method === "GET") {
        return taskStatusHandler(taskQueue, url.pathname.split("/").pop()!);
      }
      return new Response("Not Found", { status: 404 });
    },
  };
}
