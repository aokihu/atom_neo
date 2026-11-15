/** Bounded per-instance diagnostic history and optional Client `/diagnostics` reads. */

export type DiagnosticStage = "install" | "config" | "process" | "platform" | "delivery";

export type DiagnosticEvent = {
  at: string;
  stage: DiagnosticStage;
  level: "info" | "warn" | "error";
  message: string;
};

export type ClientDiagnostics =
  | { status: "ok"; checks: unknown[] }
  | { status: "unsupported" }
  | { status: "unreachable"; error: string };

export const MAX_DIAGNOSTIC_EVENTS = 50;
export const DEFAULT_DIAGNOSTIC_SUMMARY_LIMIT = 5;
export const DIAGNOSTICS_TIMEOUT_MS = 2_000;

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
    return { status: "ok", checks };
  } catch (error) {
    const timedOut = error instanceof Error
      && (error.name === "TimeoutError" || error.name === "AbortError");
    return unreachable(timedOut ? "Diagnostics request timed out" : "Diagnostics request failed");
  }
}
