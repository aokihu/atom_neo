import { BusEvents } from "@atom-neo/shared";
import type { ToolResultMetadata } from "@atom-neo/shared";
import type { ToolCallDecision, ToolCallLedger } from "@core/tools/governance";
import { formatToolGovernanceBlock } from "@core/tools/governance";
import type { ToolStatusCollector } from "./tool-result-status";
import type { StreamReporter } from "./types";

export type GovernedCall =
  | { allowed: true; stepCount: number; decision: Extract<ToolCallDecision, { allowed: true }> }
  | { allowed: false; output: string };

export function beginGovernedToolCall(params: {
  toolName: string;
  args: unknown;
  source?: "mcp";
  report: StreamReporter;
  stepCounter: { count: number };
  statuses: ToolStatusCollector;
  governance: { current: ToolCallLedger };
}): GovernedCall {
  const stepCount = ++params.stepCounter.count;
  const decision = params.governance.current.begin(params.toolName, params.args);
  params.report(BusEvents.Element.Data, {
    step: "tool-governance-decision",
    toolName: params.toolName,
    stepCount,
    ...(params.source ? { source: params.source } : {}),
    decision: decision.allowed ? "execute" : "block",
    ...(!decision.allowed ? { reason: decision.reason } : {}),
    fingerprint: decision.fingerprint,
    ...params.governance.current.snapshot(),
  });
  if (decision.allowed) return { allowed: true, stepCount, decision };

  const output = formatToolGovernanceBlock(decision);
  const error = `TOOL_GOVERNANCE_BLOCKED [${decision.reason}]`;
  params.statuses.push(params.toolName, {
    content: output,
    metadata: { ok: false, effect: "none", error, errorSource: "guard" },
  });
  return { allowed: false, output };
}

export function finishGovernedToolCall(params: {
  toolName: string;
  stepCount: number;
  decision: Extract<ToolCallDecision, { allowed: true }>;
  metadata: ToolResultMetadata;
  source?: "mcp";
  report: StreamReporter;
  governance: { current: ToolCallLedger };
}): void {
  const governanceState = params.governance.current.finish(params.decision, params.metadata.effect);
  params.report(BusEvents.Element.Data, {
    step: "tool-governance-result",
    toolName: params.toolName,
    stepCount: params.stepCount,
    ...(params.source ? { source: params.source } : {}),
    fingerprint: params.decision.fingerprint,
    ok: params.metadata.ok,
    effect: params.metadata.effect,
    ...governanceState,
  });
}
