import type { ToolResultMetadata } from "@atom-neo/shared";
import type { ToolExecutionStatus } from "./types";

/** Per-Tool FIFO of execution statuses reported by wrapped tools. */
export class ToolStatusCollector {
  #queues = new Map<string, ToolExecutionStatus[]>();

  push(toolName: string, status: ToolExecutionStatus): void {
    const queue = this.#queues.get(toolName) ?? [];
    queue.push(status);
    this.#queues.set(toolName, queue);
  }

  take(toolName: string): ToolExecutionStatus | undefined {
    const queue = this.#queues.get(toolName);
    if (!queue || queue.length === 0) return undefined;
    const status = queue.shift();
    if (queue.length === 0) this.#queues.delete(toolName);
    return status;
  }

  /** Non-destructive inspection for tests and diagnostics. */
  peek(toolName: string): readonly ToolExecutionStatus[] {
    return this.#queues.get(toolName) ?? [];
  }

  clear(): void {
    this.#queues.clear();
  }
}

export function hasStructuredValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function resolveMCPToolMetadata(result: unknown): ToolResultMetadata {
  if (!result || typeof result !== "object") {
    return { ok: true, effect: hasStructuredValue(result) ? "reference" : "none" };
  }
  const record = result as Record<string, unknown>;
  if (record.isError === true) {
    return { ok: false, effect: "none", error: "MCP tool returned isError", errorSource: "tool" };
  }
  if (Array.isArray(record.content)) {
    const contentEvidence = record.content.some(part => {
      if (!part || typeof part !== "object") return hasStructuredValue(part);
      const content = part as Record<string, unknown>;
      return content.type === "text"
        ? typeof content.text === "string" && content.text.trim().length > 0
        : true;
    });
    return {
      ok: true,
      effect: contentEvidence || hasStructuredValue(record.structuredContent) ? "reference" : "none",
    };
  }
  if ("toolResult" in record && !hasStructuredValue(record.toolResult)) {
    return { ok: true, effect: "none" };
  }
  return { ok: true, effect: "reference" };
}
