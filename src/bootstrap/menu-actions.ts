import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MenuActions, SessionSummary } from "@atom-neo/config-tui";
import { writeFileAtomic } from "@atom-neo/shared";
import { applyImport, exportBackup as runExport, planImport } from "./backup";
import { loadConfig } from "./config";
import { createGatewayActions } from "./gateway-actions";
import { readRuntimeFile } from "./runtime-file";

function readTheme(sandbox: string): string {
  try {
    return loadConfig(sandbox).effective.tui?.theme ?? "edex";
  } catch {
    return "edex";
  }
}

function readGatewayPort(sandbox: string): number {
  try {
    return loadConfig(sandbox).effective.gateway?.port ?? 3000;
  } catch {
    return 3000;
  }
}

async function coreRequest(sandbox: string, path: string, init: RequestInit = {}): Promise<Response> {
  const runtime = readRuntimeFile(sandbox, "core");
  return fetch(`${runtime.url.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), "x-atom-admin-token": runtime.token },
    signal: AbortSignal.timeout(2_000),
  });
}

async function runtimeOnline(sandbox: string, kind: "core" | "gateway"): Promise<boolean> {
  try {
    const runtime = readRuntimeFile(sandbox, kind);
    const url = kind === "core" ? `${runtime.url}/api/health` : `${runtime.url}/admin/clients`;
    const response = await fetch(url, {
      headers: kind === "gateway" ? { "x-atom-admin-token": runtime.token } : undefined,
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Bootstrap adapter for MenuApp; all side effects stay outside config-tui. */
export function createMenuActions(sandbox: string): MenuActions {
  let workspace = sandbox;
  const actions: MenuActions = {
    theme: readTheme(workspace),
    gatewayPort: readGatewayPort(workspace),
    gateway: createGatewayActions(workspace),
    hasConfig: (path) => existsSync(join(path, "config.json")),
    validateWorkspace: (path) => {
      const target = resolve(path);
      if (!existsSync(target)) return `Workspace does not exist: ${target}`;
      if (!statSync(target).isDirectory()) return `Workspace is not a directory: ${target}`;
      try {
        accessSync(target, constants.W_OK);
      } catch {
        return `Workspace is not writable: ${target}`;
      }
      return undefined;
    },
    setWorkspace: (path) => {
      workspace = resolve(path);
      actions.theme = readTheme(workspace);
      actions.gatewayPort = readGatewayPort(workspace);
      actions.gateway = createGatewayActions(workspace);
    },
    coreStatus: async () => await runtimeOnline(workspace, "core") ? "online" : "offline",
    gatewayStatus: async () => await runtimeOnline(workspace, "gateway") ? "online" : "offline",
    listSessions: async () => {
      const response = await coreRequest(workspace, "/api/sessions");
      if (!response.ok) throw new Error(`Cannot list sessions (${response.status})`);
      return await response.json() as SessionSummary[];
    },
    deleteSession: async (sessionId) => {
      const response = await coreRequest(workspace, `/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      if (response.status === 409) throw new Error("Session is active");
      if (!response.ok) throw new Error(`Cannot delete session (${response.status})`);
    },
    stopCore: async () => {
      const response = await coreRequest(workspace, "/api/admin/shutdown", { method: "POST" });
      if (!response.ok) throw new Error(`Cannot stop Core (${response.status})`);
    },
    exportBackup: async (input) => {
      const result = runExport({
        sandbox: workspace,
        output: input.output,
        password: input.password,
        force: input.force,
      });
      return `Exported ${result.files.length} file(s) to ${result.path}`;
    },
    importBackup: async (input) => {
      const plan = planImport({
        archive: input.archive,
        sandbox: workspace,
        password: input.password,
        envMode: input.envMode,
      });
      const result = applyImport(plan);
      return `Imported archive into ${plan.sandbox}; config: ${result.configPath}`;
    },
    setGatewayPort: (port) => {
      const path = join(workspace, "config.json");
      const config = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> : {};
      const gateway = config.gateway && typeof config.gateway === "object" ? config.gateway as Record<string, unknown> : {};
      config.gateway = { ...gateway, port };
      writeFileAtomic(path, `${JSON.stringify(config, null, 2)}\n`);
      actions.gatewayPort = port;
    },
  };
  return actions;
}
