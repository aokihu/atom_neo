import { BusEvents } from "@atom-neo/shared";
import type { ElementTask, PipelineSession } from "../../../../session/element-session";
import type { ToolCallLedger } from "../../../../tools/governance";
import { ToolCallLedger as ToolCallLedgerClass } from "../../../../tools/governance";
import type { ToolResultMetadata } from "@atom-neo/shared";
import { tool, zodSchema } from "ai";
import type { ToolDefinition } from "@atom-neo/shared";
import { stringifyToolOutput } from "../tool-loop";
import { beginGovernedToolCall, finishGovernedToolCall } from "./tool-governance-runtime";
import { ToolStatusCollector } from "./tool-result-status";
import type { StreamReporter } from "./types";

type NormalizedToolResult = {
  content: string;
  rawOutput?: unknown;
  metadata: ToolResultMetadata;
  returnValue: unknown;
};

/** Runs one governed tool call. Adapters supply `invoke` and `normalize` only. */
export async function executeGovernedTool<TRaw>(params: {
  toolName: string;
  args: unknown;
  source?: "mcp";
  errorPrefix: string;
  invoke: () => Promise<TRaw>;
  normalize: (raw: TRaw) => NormalizedToolResult;
  onSuccess?: (raw: TRaw, metadata: ToolResultMetadata) => void;
  report: StreamReporter;
  stepCounter: { count: number };
  statuses: ToolStatusCollector;
  governance: { current: ToolCallLedger };
}): Promise<unknown> {
  const governed = beginGovernedToolCall({
    toolName: params.toolName,
    args: params.args,
    source: params.source,
    report: params.report,
    stepCounter: params.stepCounter,
    statuses: params.statuses,
    governance: params.governance,
  });
  if (!governed.allowed) return governed.output;
  const { stepCount, decision } = governed;
  const start = Date.now();
  try {
    params.report(BusEvents.Element.Data, {
      step: "tool-execute-start",
      toolName: params.toolName,
      stepCount,
      ...(params.source ? { source: params.source } : {}),
      args: JSON.stringify(params.args).slice(0, 200),
    });
    const raw = await params.invoke();
    const normalized = params.normalize(raw);
    const duration = Date.now() - start;
    params.report(BusEvents.Element.Data, {
      step: "tool-execute-done",
      toolName: params.toolName,
      stepCount,
      ...(params.source ? { source: params.source } : {}),
      duration,
      ok: normalized.metadata.ok,
      effect: normalized.metadata.effect,
    });
    finishGovernedToolCall({
      toolName: params.toolName,
      stepCount,
      decision,
      metadata: normalized.metadata,
      source: params.source,
      report: params.report,
      governance: params.governance,
    });
    params.statuses.push(params.toolName, {
      content: normalized.content,
      rawOutput: normalized.rawOutput,
      metadata: normalized.metadata,
      startedAt: start,
      durationMs: duration,
    });
    params.onSuccess?.(raw, normalized.metadata);
    return normalized.returnValue;
  } catch (err: any) {
    const duration = Date.now() - start;
    const error = err?.message ?? String(err);
    params.report(BusEvents.Element.Data, {
      step: "tool-execute-error",
      toolName: params.toolName,
      stepCount,
      ...(params.source ? { source: params.source } : {}),
      duration,
      error,
    });
    finishGovernedToolCall({
      toolName: params.toolName,
      stepCount,
      decision,
      metadata: { ok: false, effect: "none", error, errorSource: "tool" },
      source: params.source,
      report: params.report,
      governance: params.governance,
    });
    params.statuses.push(params.toolName, {
      content: "",
      metadata: { ok: false, effect: "none", error, errorSource: "tool" },
      startedAt: start,
      durationMs: duration,
    });
    return `${params.errorPrefix}${error}`;
  }
}

export function buildAllAiTools(
  tools: ToolDefinition[],
  report: StreamReporter,
  stepCounter: { count: number },
  statuses: ToolStatusCollector,
  governance: { current: ToolCallLedger },
  session?: PipelineSession,
  task?: ElementTask,
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const t of tools) {
    result[t.name] = (tool as any)({
      description: t.description,
      inputSchema: zodSchema(t.inputSchema),
      execute: t.name === "intent"
        ? async () => "Intent received"
        : async (args: any, opts?: any) => executeGovernedTool({
            toolName: t.name,
            args,
            errorPrefix: "Tool execution error: ",
            invoke: () => t.execute(args, {
              abortSignal: opts?.abortSignal,
              sessionId: session?.sessionId,
              taskId: task?.id,
              chatId: task?.chatId,
              evidenceQuery: [...(session?.messages ?? [])].reverse().find((message: any) => message.role === "user")?.content
                || "",
            }),
            normalize: r => {
              const content = stringifyToolOutput(r.content);
              return {
                content,
                rawOutput: r.content,
                metadata: r.metadata,
                returnValue: r.metadata.ok ? content : "Tool execution failed",
              };
            },
            onSuccess: (_raw, metadata) => {
              if (t.name === "todowrite" && metadata.ok && session?.setTodoState) {
                session.setTodoState((args as any).todos ?? []);
              }
            },
            report,
            stepCounter,
            statuses,
            governance,
          }),
    });
  }
  return result;
}

export function createToolRuntime(params: {
  tools: ToolDefinition[];
  report: StreamReporter;
  maxSteps: number;
  session?: PipelineSession;
  task?: ElementTask;
}): {
  builtinTools: Record<string, any>;
  stepCounter: { count: number };
  statuses: ToolStatusCollector;
  governance: { current: ToolCallLedger };
} {
  const stepCounter = { count: 0 };
  const statuses = new ToolStatusCollector();
  const governance = { current: new ToolCallLedgerClass({ maxExecutions: params.maxSteps }) };
  return {
    builtinTools: buildAllAiTools(
      params.tools,
      params.report,
      stepCounter,
      statuses,
      governance,
      params.session,
      params.task,
    ),
    stepCounter,
    statuses,
    governance,
  };
}
