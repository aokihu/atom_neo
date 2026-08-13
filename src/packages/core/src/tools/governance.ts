import { createHash } from "node:crypto";
import type { ToolEffect } from "@atom-neo/shared";

export const DEFAULT_MAX_CONSECUTIVE_NO_PROGRESS = 3;

export type ToolGovernanceStopReason = "tool_call_limit";
export type ToolGovernanceBlockReason = "duplicate_request" | "tool_call_limit";

export type ToolGovernanceSnapshot = {
  attempts: number;
  executions: number;
  blocked: number;
  consecutiveNoProgress: number;
  maxExecutions: number;
  maxConsecutiveNoProgress: number;
  stopReason?: ToolGovernanceStopReason;
};

export type ToolCallDecision =
  | { allowed: true; toolName: string; fingerprint: string }
  | { allowed: false; toolName: string; fingerprint: string; reason: ToolGovernanceBlockReason };

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortObjectKeys(item)]),
  );
}

export function createToolCallFingerprint(toolName: string, args: unknown): string {
  let payload: string;
  try {
    payload = JSON.stringify([toolName, sortObjectKeys(args)]);
  } catch {
    payload = `${toolName}:${String(args)}`;
  }
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function formatToolGovernanceBlock(decision: Extract<ToolCallDecision, { allowed: false }>): string {
  return decision.reason === "duplicate_request"
    ? "Do not repeat this tool call unless another successful action changes its inputs or underlying state."
    : "Do not call another tool. Answer with the information already available.";
}

export class ToolCallLedger {
  readonly #maxExecutions: number;
  readonly #maxConsecutiveNoProgress: number;
  #attempts = 0;
  #executions = 0;
  #blocked = 0;
  #consecutiveNoProgress = 0;
  #stopReason?: ToolGovernanceStopReason;
  #fingerprintsSinceProgress = new Set<string>();

  constructor(options: { maxExecutions: number; maxConsecutiveNoProgress?: number }) {
    this.#maxExecutions = Math.max(1, Math.floor(options.maxExecutions));
    this.#maxConsecutiveNoProgress = Math.max(
      1,
      Math.floor(options.maxConsecutiveNoProgress ?? DEFAULT_MAX_CONSECUTIVE_NO_PROGRESS),
    );
  }

  begin(toolName: string, args: unknown): ToolCallDecision {
    this.#attempts++;
    const fingerprint = createToolCallFingerprint(toolName, args);
    if (this.#stopReason) {
      this.#blocked++;
      return {
        allowed: false,
        toolName,
        fingerprint,
        reason: "tool_call_limit",
      };
    }
    if (this.#fingerprintsSinceProgress.has(fingerprint)) {
      this.#blocked++;
      this.#markNoProgress();
      return { allowed: false, toolName, fingerprint, reason: "duplicate_request" };
    }

    this.#fingerprintsSinceProgress.add(fingerprint);
    this.#executions++;
    if (this.#executions >= this.#maxExecutions) this.#stopReason = "tool_call_limit";
    return { allowed: true, toolName, fingerprint };
  }

  finish(
    decision: Extract<ToolCallDecision, { allowed: true }>,
    effect: ToolEffect,
  ): ToolGovernanceSnapshot {
    if (effect !== "none") {
      this.#consecutiveNoProgress = 0;
      this.#fingerprintsSinceProgress = new Set([decision.fingerprint]);
    } else {
      this.#markNoProgress();
    }
    return this.snapshot();
  }

  rejectBatch(callCount: number): ToolGovernanceSnapshot {
    const count = Math.max(1, Math.floor(callCount));
    this.#attempts += count;
    this.#blocked += count;
    this.#markNoProgress();
    return this.snapshot();
  }

  shouldForceText(): boolean {
    return this.#stopReason !== undefined;
  }

  snapshot(): ToolGovernanceSnapshot {
    return {
      attempts: this.#attempts,
      executions: this.#executions,
      blocked: this.#blocked,
      consecutiveNoProgress: this.#consecutiveNoProgress,
      maxExecutions: this.#maxExecutions,
      maxConsecutiveNoProgress: this.#maxConsecutiveNoProgress,
      ...(this.#stopReason ? { stopReason: this.#stopReason } : {}),
    };
  }

  #markNoProgress(): void {
    this.#consecutiveNoProgress++;
  }
}
