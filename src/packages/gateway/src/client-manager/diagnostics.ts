/** Bounded per-instance diagnostic history and optional Client `/diagnostics` reads. */

export type DiagnosticStage = "install" | "config" | "process" | "platform" | "delivery";

export type DiagnosticEvent = {
  at: string;
  stage: DiagnosticStage;
  level: "info" | "warn" | "error";
  message: string;
};

export type ClientDiagnosticCheck = {
  name: string;
  ok: boolean;
  at?: string;
  detail?: string;
};

export type ClientDiagnostics =
  | { status: "ok"; checks: ClientDiagnosticCheck[] }
  | { status: "unsupported" }
  | { status: "unreachable"; error: string };

export const MAX_DIAGNOSTIC_EVENTS = 50;
export const DEFAULT_DIAGNOSTIC_SUMMARY_LIMIT = 5;
export const DIAGNOSTICS_TIMEOUT_MS = 2_000;
export const MAX_CLIENT_DIAGNOSTIC_CHECKS = 20;
export const MAX_CLIENT_DIAGNOSTIC_FIELD = 200;
export const MAX_CLIENT_DIAGNOSTIC_BYTES = 8_192;

export class DiagnosticsStore {
  #events = new Map<string, DiagnosticEvent[]>();

  record(id: string, event: Omit<DiagnosticEvent, "at"> & { at?: string }): void {
    const events = this.#events.get(id) ?? [];
    events.push({ ...event, at: event.at ?? new Date().toISOString() });
    if (events.length > MAX_DIAGNOSTIC_EVENTS) events.shift();
    this.#events.set(id, events);
  }

  list(id: string): DiagnosticEvent[] {
    return [...(this.#events.get(id) ?? [])];
  }

  summary(id: string, limit = DEFAULT_DIAGNOSTIC_SUMMARY_LIMIT): DiagnosticEvent[] {
    const count = Number.isFinite(limit)
      ? Math.max(0, Math.trunc(limit))
      : DEFAULT_DIAGNOSTIC_SUMMARY_LIMIT;
    return count === 0 ? [] : this.list(id).slice(-count);
  }

  remove(id: string): void {
    this.#events.delete(id);
  }
}

function unreachable(error: string): ClientDiagnostics {
  return { status: "unreachable", error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncate(value: string, limit = MAX_CLIENT_DIAGNOSTIC_FIELD): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

const SECRET_PATTERNS = [
  /\bbot\d+:[A-Za-z0-9_-]+/gi,
  /\b(?:token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
];

/** Keep diagnostics free of common credential forms before they reach the admin API. */
function redact(value: string): string {
  let text = value;
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[redacted]");
  return truncate(text);
}

function sanitizeCheck(value: unknown): ClientDiagnosticCheck | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.name !== "string" || value.name.trim() === "") return undefined;
  if (typeof value.ok !== "boolean") return undefined;

  const check: ClientDiagnosticCheck = { name: redact(value.name.trim()), ok: value.ok };
  if (typeof value.at === "string" && value.at !== "") check.at = truncate(value.at, 64);
  if (typeof value.detail === "string" && value.detail !== "") check.detail = redact(value.detail);
  return check;
}

function boundedChecks(checks: readonly unknown[]): ClientDiagnosticCheck[] {
  const result: ClientDiagnosticCheck[] = [];
  for (const value of checks.slice(0, MAX_CLIENT_DIAGNOSTIC_CHECKS)) {
    const check = sanitizeCheck(value);
    if (!check) return [];
    result.push(check);
  }

  const encoder = new TextEncoder();
  while (result.length > 0 && encoder.encode(JSON.stringify(result)).byteLength > MAX_CLIENT_DIAGNOSTIC_BYTES) {
    result.pop();
  }
  return result;
}

export async function readClientDiagnostics(
  client: { id: string; url: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ClientDiagnostics> {
  try {
    const response = await fetchImpl(`${client.url}/diagnostics`, {
      method: "GET",
      signal: AbortSignal.timeout(DIAGNOSTICS_TIMEOUT_MS),
    });
    if (response.status === 404) return { status: "unsupported" };
    if (!response.ok) return unreachable(`HTTP ${response.status}`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return unreachable("Invalid diagnostics response");
    }

    const checks = isRecord(body) ? body.checks : undefined;
    if (!Array.isArray(checks)) return unreachable("Invalid diagnostics response");
    const bounded = boundedChecks(checks);
    if (bounded.length === 0 && checks.length > 0) return unreachable("Invalid diagnostics response");
    return { status: "ok", checks: bounded };
  } catch (error) {
    const timedOut = error instanceof Error
      && (error.name === "TimeoutError" || error.name === "AbortError");
    return unreachable(timedOut ? "Diagnostics request timed out" : "Diagnostics request failed");
  }
}
