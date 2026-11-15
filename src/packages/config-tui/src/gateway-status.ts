import {
  listInstances,
  readRuntimeFile,
  upsertInstance,
} from "@atom-neo/shared";
import type { InstanceWriteResult } from "@atom-neo/shared";
import type { GatewayInstanceFields } from "./gateway-instance-form";

export type GatewaySource =
  | { type: "package"; id: string; version: string }
  | { type: "directory"; directory: string };

export type GatewayDiagnosticEvent = {
  at: string;
  stage: string;
  level: string;
  message: string;
};

export type GatewayClientDiagnostics =
  | { status: "ok"; checks: unknown[] }
  | { status: "unsupported" }
  | { status: "unreachable"; error: string };

export type GatewayInstanceStatus = {
  id: string;
  platform: string;
  source: GatewaySource;
  running: boolean;
  desired: boolean;
  state: string;
  port: number;
  active?: { id: string; platform: string; port: number; url: string };
  diagnostics: GatewayDiagnosticEvent[];
  config: GatewayInstanceFields;
  clientArgs: Record<string, string>;
  secretFields: string[];
  stdio: "inherit" | "ignore";
};

export type GatewayDiagnostics = {
  id: string;
  state: string;
  events: GatewayDiagnosticEvent[];
  client: GatewayClientDiagnostics;
};

export type GatewayInstanceActions = {
  install: (archive: string) => Promise<string>;
  load: (directory: string, id?: string) => Promise<string>;
  pack: (directory: string) => Promise<string>;
};

export const GATEWAY_ADMIN_TIMEOUT_MS = 5_000;

async function adminRequest(
  sandbox: string,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  let runtime;
  try {
    runtime = readRuntimeFile(sandbox, "gateway");
  } catch {
    throw new Error(`Gateway is offline for sandbox ${sandbox}`);
  }
  try {
    return await fetchImpl(`${runtime.url.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), "x-atom-admin-token": runtime.token },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`Gateway admin request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/** Offline returns null; admin failures throw without exposing the token. */
export async function fetchGatewayStatus(
  sandbox: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = GATEWAY_ADMIN_TIMEOUT_MS,
): Promise<GatewayInstanceStatus[] | null> {
  let response: Response;
  try {
    response = await adminRequest(sandbox, "/admin/clients", { method: "GET" }, fetchImpl, timeoutMs);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Gateway is offline")) return null;
    throw error;
  }
  if (!response.ok) throw new Error(`Gateway status failed (${response.status})`);
  const body = await response.json() as { clients?: unknown };
  if (!Array.isArray(body.clients)) throw new Error("Invalid Gateway status response");
  return body.clients as GatewayInstanceStatus[];
}

export async function fetchGatewayDiagnostics(
  sandbox: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = GATEWAY_ADMIN_TIMEOUT_MS,
): Promise<GatewayDiagnostics> {
  const response = await adminRequest(
    sandbox,
    `/admin/clients/${encodeURIComponent(id)}/diagnostics`,
    { method: "GET" },
    fetchImpl,
    timeoutMs,
  );
  if (!response.ok) throw new Error(`Gateway diagnostics failed (${response.status})`);
  return await response.json() as GatewayDiagnostics;
}

export async function gatewayAction(
  sandbox: string,
  action: "start" | "stop" | "reload",
  id?: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = GATEWAY_ADMIN_TIMEOUT_MS,
): Promise<unknown> {
  const response = await adminRequest(sandbox, "/admin/clients", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, clientId: id }),
  }, fetchImpl, timeoutMs);
  const body = await response.json().catch(() => null) as {
    error?: string;
    results?: Array<{ ok?: boolean; error?: string }>;
  } | null;
  if (!response.ok) {
    const detail = body?.results?.find(result => result.ok === false)?.error ?? body?.error ?? `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return body;
}

/** Persist an edited instance through the shared single-write entry. */
export function saveGatewayInstance(
  sandbox: string,
  status: GatewayInstanceStatus,
  values: Record<string, string>,
  secrets: Record<string, string> = {},
): InstanceWriteResult {
  const existing = listInstances(sandbox).find(instance => instance.id === status.id);
  if (!existing) throw new Error(`Unknown client instance: ${status.id}`);

  const clientArgs = { ...(existing.clientArgs ?? {}) };
  for (const [field, declared] of Object.entries(status.config)) {
    if (declared.secret) continue;
    const value = values[field];
    if (value === undefined || value === "") delete clientArgs[field];
    else clientArgs[field] = value;
  }

  const source = status.source.type === "package"
    ? { package: { id: status.source.id, version: status.source.version } }
    : { directory: status.source.directory };
  const client = {
    id: status.id,
    ...source,
    ...(Object.keys(clientArgs).length > 0 ? { clientArgs } : {}),
    ...(existing.credentials ? { credentials: existing.credentials } : {}),
    stdio: status.stdio,
  };
  return upsertInstance(sandbox, client, secrets);
}
