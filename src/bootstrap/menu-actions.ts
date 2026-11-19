import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MenuActions, SessionSummary } from "@atom-neo/config-tui";
import { writeFileAtomic } from "@atom-neo/shared";
import { applyImport, exportBackup as runExport, inspectBackupArchive, planImport, validateBackupPassword } from "./backup";
import { createGatewayActions } from "./gateway-actions";
import { readRuntimeFile } from "./runtime-file";

/** Strict read-only config access: missing files never create or normalize config. */
function readConfig(sandbox: string): Record<string, unknown> | undefined {
  const path = join(sandbox, "config.json");
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function readTheme(sandbox: string): string {
  const tui = readConfig(sandbox)?.tui;
  return tui !== null && typeof tui === "object" && typeof (tui as Record<string, unknown>).theme === "string"
    ? (tui as Record<string, unknown>).theme as string
    : "edex";
}

function readGatewayPort(sandbox: string): number {
  const gateway = readConfig(sandbox)?.gateway;
  return gateway !== null && typeof gateway === "object" && typeof (gateway as Record<string, unknown>).port === "number"
    ? (gateway as Record<string, unknown>).port as number
    : 3000;
}

/** Normalize once so validation and activation always agree on the target path. */
function resolveWorkspace(path: string): { target: string; problem?: string } {
  if (!path.trim()) return { target: "", problem: "Workspace path is required" };
  const target = resolve(path);
  if (!existsSync(target)) return { target, problem: `Workspace does not exist: ${target}` };
  try {
    if (!statSync(target).isDirectory()) return { target, problem: `Workspace is not a directory: ${target}` };
    accessSync(target, constants.W_OK);
  } catch {
    return { target, problem: `Workspace is not writable: ${target}` };
  }
  return { target };
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
export function createMenuActions(sandbox: string, corePort = 3100): MenuActions {
  let workspace = sandbox;
  const actions: MenuActions = {
    theme: readTheme(workspace),
    gatewayPort: readGatewayPort(workspace),
    gateway: createGatewayActions(workspace),
    hasConfig: (path) => existsSync(join(path, "config.json")),
    validateWorkspace: (path) => resolveWorkspace(path).problem,
    setWorkspace: (path) => {
      const { target, problem } = resolveWorkspace(path);
      if (problem) throw new Error(problem);
      workspace = target;
      actions.theme = readTheme(workspace);
      actions.gatewayPort = readGatewayPort(workspace);
      actions.gateway = createGatewayActions(workspace);
      return workspace;
    },
    refreshSettings: () => {
      actions.theme = readTheme(workspace);
      actions.gatewayPort = readGatewayPort(workspace);
      return { theme: actions.theme, gatewayPort: actions.gatewayPort };
    },
    coreStatus: async () => await runtimeOnline(workspace, "core") ? "online" : "offline",
    coreTarget: async () => {
      const runtime = readRuntimeFile(workspace, "core");
      const url = new URL(runtime.url);
      return { host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port) };
    },
    coreStartTarget: () => ({ host: "127.0.0.1", port: corePort }),
    gatewayStatus: async () => await runtimeOnline(workspace, "gateway") ? "online" : "offline",
    listSessions: async () => {
      const response = await coreRequest(workspace, "/api/sessions");
      if (!response.ok) throw new Error(`Cannot list sessions (${response.status})`);
      return await response.json() as SessionSummary[];
    },
    deleteSession: async (sessionId) => {
      const response = await coreRequest(workspace, `/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      if (response.status === 409) throw new Error("Session is active or attached");
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
    validateBackupPassword: (password) => {
      try {
        validateBackupPassword(password, true);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    inspectBackup: async (archive) => ({ encrypted: inspectBackupArchive(archive).encrypted }),
    setGatewayPort: (port) => {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Port must be an integer between 1 and 65535");
      }
      const path = join(workspace, "config.json");
      let raw: unknown = {};
      if (existsSync(path)) {
        try {
          raw = JSON.parse(readFileSync(path, "utf8"));
        } catch (error) {
          throw new Error(`Invalid config.json: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const config = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const gateway = config.gateway !== null && typeof config.gateway === "object" && !Array.isArray(config.gateway)
        ? config.gateway as Record<string, unknown>
        : {};
      writeFileAtomic(path, `${JSON.stringify({ ...config, gateway: { ...gateway, port } }, null, 2)}\n`, { mode: 0o600 });
      actions.gatewayPort = port;
    },
  };
  return actions;
}
