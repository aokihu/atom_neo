import { randomUUID } from "node:crypto";
import type {
  ToolDefinition,
  ToolRecord,
  ToolRecordStatus,
  ToolResultMetadata,
  ToolsGroup,
  ToolsGroupSummary,
  ToolRecordSummary,
} from "@atom-neo/shared";

const SUMMARY_LIMIT = 240;
const DETAIL_LIMIT = 20_000;

export type AppendToolRecord = {
  modelStep: number;
  batchIndex: number;
  toolCallId: string;
  toolName: string;
  source: ToolDefinition["source"];
  startedAt: number;
  durationMs: number;
  input: unknown;
  output?: unknown;
  metadata: ToolResultMetadata;
};

export type ToolRecordQuery = {
  toolsGroupId?: string;
  recordIds?: readonly string[];
  fromStep?: number;
  toStep?: number;
  status?: ToolRecordStatus;
  toolName?: string;
  limit?: number;
  cursor?: number;
};

export class ToolRecordStore {
  #groups = new Map<string, ToolsGroup[]>();

  beginGroup(sessionId: string, taskId: string, topic = ""): ToolsGroup {
    const group: ToolsGroup = {
      id: `tg-${randomUUID()}`,
      sessionId,
      taskId,
      topic,
      createdAt: Date.now(),
      status: "active",
      records: [],
      summary: "",
    };
    const groups = this.#groups.get(sessionId) ?? [];
    groups.push(group);
    this.#groups.set(sessionId, groups);
    return group;
  }

  append(group: ToolsGroup, input: AppendToolRecord): ToolRecord {
    if (group.status !== "active") throw new Error(`ToolsGroup is not active: ${group.id}`);
    const step = group.records.length + 1;
    const rawInput = cloneBounded(input.input);
    const rawOutput = cloneBounded(input.output);
    const record: ToolRecord = {
      id: `${group.id}-${step}`,
      toolsGroupId: group.id,
      step,
      modelStep: input.modelStep,
      batchIndex: input.batchIndex,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      source: input.source,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      input: rawInput.value,
      inputSummary: summarizeValue(input.input),
      ...(input.output === undefined ? {} : { output: rawOutput.value }),
      resultSummary: input.metadata.ok
        ? summarizeValue(input.output)
        : summarizeText(input.metadata.error),
      metadata: structuredClone(input.metadata),
      ...(rawInput.truncated || rawOutput.truncated ? { truncated: true } : {}),
    };
    group.records.push(record);
    return record;
  }

  seal(group: ToolsGroup, status: "sealed" | "interrupted" = "sealed"): ToolsGroup {
    if (group.status !== "active") return group;
    group.status = status;
    group.sealedAt = Date.now();
    group.summary = summarizeGroup(group);
    return group;
  }

  getRecord(sessionId: string, recordId: string): ToolRecord | undefined {
    const parsed = parseToolRecordId(recordId);
    if (!parsed) return undefined;
    const group = this.#groups.get(sessionId)?.find(item => item.id === parsed.toolsGroupId);
    return group?.records.find(record => record.step === parsed.step);
  }

  query(sessionId: string, query: ToolRecordQuery): { records: ToolRecord[]; nextCursor?: number } {
    const ids = query.recordIds ? new Set(query.recordIds) : undefined;
    const all = (this.#groups.get(sessionId) ?? [])
      .filter(group => !query.toolsGroupId || group.id === query.toolsGroupId)
      .flatMap(group => group.records)
      .filter(record => !ids || ids.has(record.id))
      .filter(record => query.fromStep === undefined || record.step >= query.fromStep)
      .filter(record => query.toStep === undefined || record.step <= query.toStep)
      .filter(record => !query.toolName || record.toolName === query.toolName)
      .filter(record => !query.status || toStatus(record.metadata) === query.status);
    const cursor = Math.max(0, query.cursor ?? 0);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const records = all.slice(cursor, cursor + limit);
    return {
      records: structuredClone(records),
      ...(cursor + records.length < all.length ? { nextCursor: cursor + records.length } : {}),
    };
  }

  summarize(sessionId: string, maxGroups = 8, maxRecords = 16): {
    groups: ToolsGroupSummary[];
    recentRecords: ToolRecordSummary[];
  } | undefined {
    const groups = (this.#groups.get(sessionId) ?? []).filter(group => group.status !== "active");
    if (groups.length === 0) return undefined;
    const selected = groups.slice(-maxGroups);
    const records = selected.flatMap(group => group.records).slice(-maxRecords);
    return {
      groups: selected.map(group => ({
        id: group.id,
        topic: group.topic,
        createdAt: group.createdAt,
        status: group.status as Exclude<ToolsGroup["status"], "active">,
        steps: group.records.length ? `1..${group.records.length}` : "",
        tools: [...new Set(group.records.map(record => record.toolName))].join(","),
        success: group.records.filter(record => record.metadata.ok).length,
        failed: group.records.filter(record => !record.metadata.ok).length,
        summary: group.summary,
      })),
      recentRecords: records.map(record => ({
        id: record.id,
        step: record.step,
        tool: record.toolName,
        status: toStatus(record.metadata),
        input: record.inputSummary,
        result: record.resultSummary,
      })),
    };
  }

  exportSession(sessionId: string): ToolsGroup[] {
    return structuredClone(this.#groups.get(sessionId) ?? []);
  }

  restoreSession(sessionId: string, groups: readonly ToolsGroup[]): void {
    this.#groups.set(sessionId, structuredClone(groups).map(group => {
      if (group.status !== "active") return group;
      return {
        ...group,
        status: "interrupted" as const,
        sealedAt: Date.now(),
        summary: summarizeGroup(group),
      };
    }));
  }

  removeSession(sessionId: string): void {
    this.#groups.delete(sessionId);
  }
}

export function parseToolRecordId(recordId: string): { toolsGroupId: string; step: number } | undefined {
  const match = /^(tg-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([1-9][0-9]*)$/i.exec(recordId);
  if (!match) return undefined;
  return { toolsGroupId: match[1]!, step: Number(match[2]) };
}

function summarizeGroup(group: Pick<ToolsGroup, "records">): string {
  const tools = [...new Set(group.records.map(record => record.toolName))].join(", ");
  const failed = group.records.filter(record => !record.metadata.ok);
  const failure = failed.length > 0 ? `; ${failed.length} failed: ${failed.map(item => item.resultSummary).join(" | ")}` : "";
  return summarizeText(`${group.records.length} real Tool executions using ${tools || "none"}${failure}`);
}

function toStatus(metadata: ToolResultMetadata): ToolRecordStatus {
  return metadata.ok ? "success" : "failed";
}

function summarizeValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return summarizeText(value);
  if (Array.isArray(value)) {
    const head = value.slice(0, 3).map(item => summarizeText(stringify(item), 60)).join(" | ");
    return summarizeText(`list(${value.length})${head ? `: ${head}` : ""}`);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 8);
    return summarizeText(entries.map(([key, item]) => `${key}=${summarizeText(stringify(item), 60)}`).join(", "));
  }
  return summarizeText(String(value));
}

function summarizeText(value: string, limit = SUMMARY_LIMIT): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function cloneBounded(value: unknown): { value: unknown; truncated: boolean } {
  if (value === undefined) return { value: undefined, truncated: false };
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return { value: String(value), truncated: false };
  }
  if (text === undefined) return { value: String(value), truncated: false };
  if (text.length > DETAIL_LIMIT) return { value: `${text.slice(0, DETAIL_LIMIT - 1)}…`, truncated: true };
  try {
    return { value: JSON.parse(text), truncated: false };
  } catch {
    return { value: text, truncated: false };
  }
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value ?? "");
  } catch {
    return String(value);
  }
}
