import type { ModelMessage } from "ai";
import type { ToolContextInjection, ToolDefinition, ToolResultMetadata } from "@atom-neo/shared";
import type { ContextService } from "@core/context/context-service";
import type { ConversationFlowState, ToolEffectSummary } from "../types";

export function resolveModelInput(input: Pick<
  ConversationFlowState,
  "contextSnapshot" | "systemText" | "userMessages"
>) {
  return {
    systemText: input.contextSnapshot?.content ?? input.systemText ?? "",
    userMessages: (input.userMessages ?? []).map(message => message.role === "assistant" && message.reasoning_content
      ? { role: "assistant" as const, content: [
          { type: "reasoning" as const, text: message.reasoning_content },
          { type: "text" as const, text: message.content },
        ] }
      : { role: message.role, content: message.content }) as ModelMessage[],
  };
}

export function resolveCacheMetrics(usage?: {
  inputTokens?: number; outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number; noCacheTokens?: number };
}) {
  return {
    inputTokens: usage?.inputTokens ?? null,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
    noCacheTokens: usage?.inputTokenDetails?.noCacheTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  };
}

export function resolveTokenMetrics(
  usage?: { totalTokens?: number },
  totalUsage?: { totalTokens?: number },
): { contextTokens: number; totalUsageTokens: number } {
  const contextTokens = usage?.totalTokens ?? 0;
  return {
    contextTokens,
    totalUsageTokens: totalUsage?.totalTokens ?? contextTokens,
  };
}

export function summarizeToolEffects(metadata: readonly ToolResultMetadata[]): ToolEffectSummary {
  const summary: ToolEffectSummary = {
    evidence: 0,
    referenceEvidence: 0,
    stateChanged: 0,
    none: 0,
    failed: 0,
  };
  for (const item of metadata) {
    if (!item.ok) summary.failed++;
    else if (item.effect === "evidence") summary.evidence++;
    else if (item.effect === "reference") summary.referenceEvidence++;
    else if (item.effect === "state_changed") summary.stateChanged++;
    else summary.none++;
  }
  return summary;
}

export function shouldRecordToolResult(
  definition: Pick<ToolDefinition, "recordPolicy"> | undefined,
  metadata: ToolResultMetadata,
): boolean {
  return definition?.recordPolicy !== "exclude"
    && (metadata.ok || metadata.errorSource === "tool");
}

export function injectToolContext(params: {
  contextService: ContextService;
  injection: ToolContextInjection;
  sessionId: string;
  topicId?: string;
  contextOwner?: ConversationFlowState["contextOwner"];
  stepId?: string;
}): ToolContextInjection["scope"] {
  const scope = params.injection.scope === "topic" && !params.topicId
    ? "session"
    : params.injection.scope;
  const owner = scope === "session"
    ? { sessionId: params.sessionId }
    : scope === "topic"
      ? { sessionId: params.sessionId, topicId: params.topicId }
      : {
          ...params.contextOwner,
          ...(scope === "step" ? { stepId: params.stepId } : {}),
        };
  params.contextService.put({ ...params.injection, scope, owner });
  return scope;
}
